export interface SampleDocument {
  id: string;
  label: string;
  text: string;
}

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    id: 'incident',
    label: 'Load Incident Report',
    text: [
      'SEV1 Auth Token Exposure on Staging Gateway',
      'Reporter: sinta.pratama@example.org (+62 812-3456-7890)',
      'Affected host: https://auth-gw.internal:8443/v2/sessions (10.24.18.9)',
      'Incident detail: A developer committed a test key AIzaSyExampleDemoKey1234567890abcd into a staging config.',
      'Customer reference NIK 3174051208950001 triggered an audit alert during automated log replay.'
    ].join('\n')
  },
  {
    id: 'nda',
    label: 'Load Vendor NDA',
    text: [
      'Draft Mutual Non-Disclosure Addendum',
      'Primary contact: procurement@vendor.example.com | Phone: +62 811-2233-4455',
      'Clause 4.2: Supplier accepts unlimited liability for unauthorized disclosure of billing records.',
      'Clause 7.1: Agreement will auto-renew annually unless written notice arrives 60 days prior.'
    ].join('\n')
  }
];
