import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { ToastContainer } from '@/components/Toast';
import { supabase } from '@/lib/supabase';

export function StorefrontLayout() {
  const [announcement, setAnnouncement] = useState('Free shipping on orders over INR 75');

  useEffect(() => {
    supabase
      .from('announcements')
      .select('message')
      .eq('enabled', true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.message) setAnnouncement(data.message);
      });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Navbar />
      {announcement && (
        <div className="relative z-30 border-b border-ink-200 bg-ink-950 px-3 py-2 text-white sm:py-2.5">
          <p className="text-center text-[10px] font-medium uppercase tracking-[0.16em] sm:text-xs">{announcement}</p>
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ToastContainer />
    </div>
  );
}
