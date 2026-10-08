# Evaluation report

Config: embed=`hash` llm=`stub` store=`local` - 28 golden questions

## Retrieval

| mode | hit@1 | hit@3 | hit@5 | MRR |
|---|---|---|---|---|
| dense | 0.36 | 0.75 | 0.79 | 0.54 |
| lexical | 0.71 | 0.89 | 0.96 | 0.82 |
| hybrid | 0.54 | 0.79 | 0.79 | 0.66 |
| hybrid+rerank | 0.71 | 0.82 | 0.82 | 0.78 |

## Retrieval misses (hybrid+rerank rank > 3)

- **What laboratories does the university have?** expected `['campus-life/laboratories']` rank=9 got ['https://cyberjaya.edu.my/programme/foundation-in-science-2', 'https://cyberjaya.edu.my/programme/foundation-in-arts', 'https://cyberjaya.edu.my/programme/foundation-in-allied-science']
- **How do I apply online?** expected `['online-application', 'admission']` rank=None got ['https://cyberjaya.edu.my/programme/diploma-in-3d-animation', 'https://cyberjaya.edu.my/programme/diploma-in-accounting', 'https://cyberjaya.edu.my/programme/master-of-physiotherapy']
- **What payment options are there for tuition fees?** expected `['online-payment-options']` rank=7 got ['https://cyberjaya.edu.my/admission/fees', 'https://cyberjaya.edu.my/admission/guidelines-procedures/guidelines-procedures', 'https://cyberjaya.edu.my/admission/guidelines-procedures']
- **Tell me about the history of the University of Cyberjaya** expected `['background/about']` rank=None got ['https://cyberjaya.edu.my/university', 'https://cyberjaya.edu.my/programme/bachelor-of-medicine-bachelor-ofsurgery-mbbs', 'https://cyberjaya.edu.my/programme/bachelor-of-medicine-bachelor-ofsurgery-mbbs']
- **Is there a discount for alumni progressing to a master's degree?** expected `['alumni']` rank=None got ['https://cyberjaya.edu.my/programme/doctor-of-business-administration', 'https://cyberjaya.edu.my/programme/master-of-clinical-psychology', 'https://cyberjaya.edu.my/programme/master-of-pharmaceutical-sciences']
