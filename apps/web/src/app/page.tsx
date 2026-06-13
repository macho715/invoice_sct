import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <h1>SCT_ONTOLOGY Invoice Audit Platform</h1>
      <p>Phase 1 MVP — upload invoice/evidence and run dry-run validation.</p>
      <p><Link className="btn" href="/invoice-audit/upload">Start audit</Link></p>
    </main>
  );
}
