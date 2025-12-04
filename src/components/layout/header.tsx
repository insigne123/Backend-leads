import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Rocket className="h-6 w-6 text-primary" />
            <span className="font-bold">Startify</span>
          </Link>
          <nav className="hidden items-center space-x-6 text-sm font-medium md:flex">
            <Link href="#home" className="transition-colors hover:text-primary">
              Home
            </Link>
            <Link href="#about" className="transition-colors hover:text-primary">
              About
            </Link>
            <Link href="#contact" className="transition-colors hover:text-primary">
              Contact
            </Link>
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
