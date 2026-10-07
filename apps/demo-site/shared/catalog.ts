export const products = [
  { id: 'route-atlas', name: 'Route Atlas', category: 'Mapping', number: '01', description: 'A considered way to map the paths through your application.', detail: 'Sketch routes, follow connections, and leave useful notes for the next person. Route Atlas is a fictional toolkit for small teams building thoughtful software.', features: ['Route inventory', 'Navigation studies', 'Shared field notes'], color: 'sage' },
  { id: 'field-notes', name: 'Field Notes', category: 'Research', number: '02', description: 'A quiet workspace for observations worth keeping.', detail: 'Collect questions, document experiments, and find a thread through the noise. These fictional notebooks keep a project’s working history close at hand.', features: ['Research journals', 'Weekly observations', 'Project collections'], color: 'sand' },
  { id: 'signal-kit', name: 'Signal Kit', category: 'Observability', number: '03', description: 'Small instruments. A clearer picture of what changed.', detail: 'A fictional set of practical instruments for understanding the systems you work with. Keep measurements simple and the reasoning visible.', features: ['Event timelines', 'Session sketches', 'Transparent measurements'], color: 'rose' },
] as const;
export type DemoAccount = 'demo' | 'visitor' | 'analyst';
export interface SiteState { account: DemoAccount | null; preferences: { digest: boolean; workspace: 'personal' | 'team' } }
export const labResources = {
  '/admin-demo': { title: 'Administration preview', status: 403, content: 'SPIDERBRAIN LAB RESOURCE\nACCESS=DEMO_RESTRICTED\nWORKSPACE=fictional-labs\nNo production administration is available.' },
  '/admin-old-demo': { title: 'Archived administration', status: 404, content: 'SPIDERBRAIN LAB RESOURCE\nARCHIVE=DEMO_ONLY\nThis fictional retired console has no active services.' },
  '/.env-demo': { title: 'Environment specimen', status: 200, content: 'SPIDERBRAIN LAB RESOURCE\nENVIRONMENT=DEMO\nDATABASE=demo_database\nDB_USER=demo_user\nDB_PASSWORD=FAKE_PASSWORD\nAPI_KEY=SPIDERBRAIN_DEMO_ONLY' },
  '/.git-demo': { title: 'Repository specimen', status: 200, content: 'SPIDERBRAIN LAB RESOURCE\nREPOSITORY=fictional-labs\nBRANCH=demo-main\nCOMMIT=DEMO000000\nThis is literal example text, not a Git checkout.' },
  '/backup-demo': { title: 'Backup specimen', status: 404, content: 'SPIDERBRAIN LAB RESOURCE\nBACKUP=demo_archive\nRECORDS=0\nNo real backup is present.' },
  '/config-demo': { title: 'Configuration specimen', status: 404, content: 'SPIDERBRAIN LAB RESOURCE\nMODE=DEMO\nHOST=example.invalid\nNo configuration file is read.' },
  '/internal-demo': { title: 'Internal workspace preview', status: 403, content: 'SPIDERBRAIN LAB RESOURCE\nSCOPE=FICTIONAL\nACCESS=DEMO_RESTRICTED' },
  '/debug-demo': { title: 'Debug specimen', status: 200, content: 'SPIDERBRAIN LAB RESOURCE\nDEBUG=EXAMPLE\nPROCESS_DATA=NONE\nNo process or machine information is exposed.' },
} as const;
export const siteRoutes = ['/', '/products', '/products/:id', '/search', '/login', '/register', '/account', '/profile', '/settings', '/about', '/contact', ...Object.keys(labResources)];
