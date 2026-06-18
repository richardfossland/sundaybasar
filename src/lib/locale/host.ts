// Norwegian UI strings for the Sunday Account host surface (login + dashboard).
// The rest of SundayBasar uses inline Norwegian; the host SSO copy is collected
// here so the login/dashboard strings live in one place. Engelsk kode, norsk UI.

export const host = {
  brand: 'SundayBasar',

  login: {
    title: 'Logg inn som arrangør',
    lede: 'Logg inn for å se og styre basarene dine.',
    emailLabel: 'E-post',
    emailPlaceholder: 'deg@menigheten.no',
    sendMagicLink: 'Send innloggingslenke',
    sending: 'Sender …',
    sentTitle: 'Sjekk innboksen',
    sentBody: (email: string) =>
      `Vi har sendt en innloggingslenke til ${email}.`,
    or: 'eller',
    google: 'Logg inn med Sunday-konto',
    error: 'Klarte ikke å sende lenken — sjekk adressen og prøv igjen.',
    authError: 'Innloggingen feilet. Prøv på nytt.',
    backToStart: 'Tilbake til forsiden',
    note:
      'Innlogging er bare for arrangører. Deltakerne blir med med basarkoden — helt uten innlogging.',
  },

  dashboard: {
    title: 'Mine basarer',
    lede: 'Basarene du har opprettet mens du var innlogget.',
    signedInAs: (email: string) => `Innlogget som ${email}`,
    signOut: 'Logg ut',
    createNew: 'Opprett ny basar',
    loading: 'Laster …',
    empty: 'Du har ingen basarer ennå. Opprett en, så dukker den opp her.',
    open: 'Åpne',
    code: 'Kode',
    statusOpen: 'Pågår',
    statusEnded: 'Avsluttet',
    players: (n: number) => `${n} ${n === 1 ? 'deltaker' : 'deltakere'}`,
    delete: 'Slett',
    deleting: 'Sletter …',
    confirmDelete: (code: string) =>
      `Slette basaren «${code}»? Alle deltakere, årer, premier og trekninger forsvinner. Dette kan ikke angres.`,
    deleteFailed: 'Kunne ikke slette basaren — prøv igjen.',
    loadFailed: 'Kunne ikke laste basarene.',
  },

  landingLink: 'Arrangør? Logg inn',
} as const
