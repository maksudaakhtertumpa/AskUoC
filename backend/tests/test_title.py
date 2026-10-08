from app.rag.title import MAX_TITLE, clean_title, generate_title, heuristic_title
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage


def test_heuristic_title_uses_meaningful_words():
    assert heuristic_title("What is on the admission page?") == "Admission Page"
    assert (
        heuristic_title("How much are the fees for the Diploma in Information Technology?")
        == "Fees Diploma Information Technology"
    )
    assert heuristic_title("???") == "???" or heuristic_title("???")  # never empty


def test_clean_title_strips_quotes_prefix_and_punctuation():
    assert clean_title('"Diploma IT Fees."') == "Diploma IT Fees"
    assert clean_title("Title: **MBBS Entry Requirements**") == "MBBS Entry Requirements"
    assert clean_title("Line one\nLine two") == "Line one"
    assert len(clean_title("word " * 40)) <= MAX_TITLE


async def test_llm_title_is_used_and_cleaned():
    llm = GenericFakeChatModel(messages=iter([AIMessage('"Nursing Scholarships."')]))
    assert await generate_title(llm, "Is there a scholarship for nursing students?") == "Nursing Scholarships"


async def test_falls_back_to_heuristic_on_llm_failure_or_empty():
    class Broken(GenericFakeChatModel):
        def _generate(self, *a, **k):
            raise RuntimeError("quota exceeded")

    assert await generate_title(Broken(messages=iter([])), "What is on the admission page?") == "Admission Page"
    assert (
        await generate_title(GenericFakeChatModel(messages=iter([AIMessage("")])), "Campus facilities?")
        == "Campus Facilities"
    )
    assert await generate_title(None, "Hostel fees") == "Hostel Fees"


async def test_a_reply_that_is_not_a_title_falls_back_to_the_heuristic():
    for junk in ("User Safety: safe", "OK", "I cannot help with that request because it is not allowed"):
        llm = GenericFakeChatModel(messages=iter([AIMessage(junk)]))
        assert (
            await generate_title(llm, "Are the facilities open to all students 24/7?")
            == "Facilities Open All Students 24"
        )
