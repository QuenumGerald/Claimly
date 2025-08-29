import './globals.css'
import Link from 'next/link'

export const metadata = { title: 'Claimly Dashboard' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="border-b bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-10">
          <div className="container flex items-center justify-between h-14">
            <div className="font-semibold">Claimly</div>
            <nav className="flex gap-4 text-sm">
              <Link href="/credits">Crédits</Link>
              <Link href="/upload">Upload</Link>
              <Link href="/filings">Filings</Link>
              <Link href="/chat">Chatbot</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
          </div>
        </header>
        <main className="container py-6">{children}</main>
      </body>
    </html>
  )
}
