// Alle tekster for storskjerm-veiviseren og tavlevisningen på ett sted.
export const tekst = {
  knapp: 'Vis på storskjerm',
  tittel: 'Vis på storskjerm',
  intro: 'Velg hvordan skjermen skal vises på projektor eller TV. Storskjermen har ingen knapper for vert.',
  lukk: 'Lukk',
  anbefalt: 'Anbefalt for din enhet',
  fullskjerm: {
    tittel: 'Fullskjerm her',
    hjelp: 'Bruk denne med HDMI-kabel, eller når skjermen speiles (for eksempel fra iPad). Dette vinduet går over til storskjermvisning uten vertskontroller.',
    knapp: 'Fullskjerm her',
  },
  eget: {
    tittel: 'Åpne skjermen i eget vindu',
    hjelp: 'Du beholder vertskontrollene i dette vinduet. Skjerm-vinduet kan flyttes til projektoren eller castes.',
    knapp: 'Åpne skjermen i eget vindu',
    flyttet: 'Skjermen ble flyttet til den andre skjermen. Trykk F for fullskjerm.',
    flyttHint: 'Dra vinduet til prosjektoren og trykk F for fullskjerm.',
    blokkert: 'Nettleseren blokkerte det nye vinduet. Tillat popup-vinduer for denne siden og prøv igjen.',
  },
  chromecast: {
    tittel: 'Chromecast / Google TV',
    steg1: 'Åpne skjermen i eget vindu (knappen over).',
    steg2: 'I Chrome-menyen ⋮ velger du «Cast …» (Lagre og del → Cast), og velger «Cast fane».',
    steg3: 'Velg TV-en i listen. Trykk F i skjerm-vinduet for fullskjerm.',
    ikkeChromium: 'Dette krever Chrome eller Edge på PC eller Chromebook. Åpne siden i en av dem for å caste.',
  },
  apple: {
    tittel: 'Apple TV (AirPlay)',
    mac1: 'Mac: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.',
    mac2: 'Velg «Bruk som separat skjerm».',
    mac3: 'Åpne skjermen i eget vindu (knappen over) og dra den over til Apple TV-en. Trykk F for fullskjerm.',
    ios1: 'iPad/iPhone: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.',
    ios2: 'Trykk deretter «Fullskjerm her» (knappen over).',
  },
  tavle: {
    avslutt: 'Avslutt tavlevisning',
  },
} as const
