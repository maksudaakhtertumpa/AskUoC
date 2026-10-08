from langchain_core.messages import HumanMessage


async def ask(graph, text, thread="t"):
    return await graph.ainvoke({"messages": [HumanMessage(text)]}, {"configurable": {"thread_id": thread}})


async def test_greeting_skips_retrieval(graph):
    out = await ask(graph, "hello")
    assert out["outcome"] == "chitchat" and out["sources"] == []


async def test_common_greetings_and_thanks_are_small_talk(graph):
    for text in ("Hi there!", "hello everyone", "Hey again.", "thanks a lot", "Terima kasih!", "Good morning"):
        out = await ask(graph, text, thread=text)
        assert out["outcome"] == "chitchat" and out["sources"] == [], text
    out = await ask(graph, "hi, what are the fees for the Diploma in Information Technology?", thread="q")
    assert out["outcome"] == "answered"  # a greeting followed by a real question is a question


async def test_answers_with_sources_and_citation(graph):
    out = await ask(graph, "What are the fees for the Diploma in Information Technology?")
    assert out["outcome"] == "answered"
    assert out["sources"][0]["url"] == "https://uoc.test/fees"
    assert "[1]" in out["messages"][-1].content


async def test_off_topic_falls_back_after_one_retry(graph):
    out = await ask(graph, "who won the football world cup in 2022")
    assert out["outcome"] == "fallback"
    assert out["retries"] == 1  # broaden was tried exactly once (loop guard)


async def test_followup_inherits_previous_topic(graph):
    await ask(graph, "Tell me about the Diploma in Nursing", thread="f")
    out = await ask(graph, "and the entry requirements?", thread="f")
    assert "nursing" in out["query"].lower()


async def test_standalone_short_question_does_not_inherit(graph):
    await ask(graph, "Tell me about the Diploma in Nursing", thread="s")
    out = await ask(graph, "who won the world cup", thread="s")
    assert "nursing" not in out["query"].lower()


async def test_reply_quote_steers_retrieval(graph):
    out = await graph.ainvoke(
        {
            "messages": [HumanMessage("what about the entry requirements?")],
            "quote": "The Diploma in Nursing is a 3-year programme.",
        },
        {"configurable": {"thread_id": "q"}},
    )
    assert "nursing" in out["query"].lower()
    assert out["sources"][0]["url"] == "https://uoc.test/programme/nursing"


async def test_no_quote_means_no_carryover_between_turns(graph):
    cfg = {"configurable": {"thread_id": "q2"}}
    await graph.ainvoke(
        {"messages": [HumanMessage("entry requirements?")], "quote": "Diploma in Nursing overview"}, cfg
    )
    out = await graph.ainvoke({"messages": [HumanMessage("library opening hours")], "quote": ""}, cfg)
    assert "nursing" not in out["query"].lower()


async def test_attachment_boilerplate_never_pollutes_the_search_query(graph):
    from app.rag.vision import with_image_context

    wrapped = with_image_context(
        "What are the fees for the Diploma in Information Technology?",
        "Poster: Open Day 12 October, Nursing scholarship 40%",
    )
    out = await ask(graph, wrapped, thread="att")
    assert out["outcome"] == "answered" and out["sources"][0]["url"] == "https://uoc.test/fees"
    q = out["query"].lower()
    assert "untrusted" not in q and "attached" not in q and "instructions" not in q  # boilerplate excluded
    assert "open day" in q  # real transcription words enrich the search
    assert out["question"].strip().endswith("Information Technology?")

    unreadable = with_image_context(
        "What are the fees for the Diploma in Information Technology?", "the attachments could not be read right now"
    )
    out = await ask(graph, unreadable, thread="att2")
    assert out["outcome"] == "answered" and "could not" not in out["query"].lower()
