import { useEffect, useState } from 'react';
import { Check, X, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Badge, Spinner, EmptyState } from '@/components/ui';
import { type Review } from '@/types';
import { formatDate } from '@/lib/utils';
import { statusVariant } from '@/lib/utils';

export function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const perPage = 10;

  const fetchData = async () => {
    setLoading(true);
    let query = supabase.from('reviews').select('*, product:products(name)', { count: 'exact' });
    if (filter !== 'all') query = query.eq('status', filter);
    const { data, count } = await query.order('created_at', { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
    setReviews((data || []) as Review[]);
    setTotalCount(count || 0);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [filter, page]);

  const totalPages = Math.ceil(totalCount / perPage);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('reviews').update({ status }).eq('id', id);
    fetchData();
  };

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-ink-900">Review Moderation</h1>

      <div className="mb-4 flex gap-2">
        {['all', 'pending', 'approved', 'hidden'].map((f) => (
          <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${filter === f ? 'bg-ink-900 text-white' : 'border border-ink-200 text-ink-600 hover:bg-ink-50'}`}>{f}</button>
        ))}
      </div>

      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : reviews.length === 0 ? <EmptyState title="No reviews found" /> : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border border-ink-100 bg-white p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-ink-900 text-sm font-bold text-white">{r.customer_name.charAt(0)}</div>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{r.customer_name}</p>
                    <p className="text-xs text-ink-500">{r.customer_email} · {formatDate(r.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} className={i < r.rating ? 'fill-accent-400 text-accent-400' : 'fill-ink-200 text-ink-200'} />)}</div>
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                </div>
              </div>
              {(r as any).product && <p className="mt-2 text-xs text-ink-500">on {(r as any).product.name}</p>}
              {r.title && <h4 className="mt-3 font-semibold text-ink-900">{r.title}</h4>}
              <p className="mt-1 text-sm text-ink-600">{r.body}</p>
              {r.status === 'pending' && (
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => updateStatus(r.id, 'approved')}><Check size={14} /> Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => updateStatus(r.id, 'hidden')}><X size={14} /> Hide</Button>
                </div>
              )}
              {r.status === 'approved' && <Button size="sm" variant="outline" className="mt-4" onClick={() => updateStatus(r.id, 'hidden')}>Hide Review</Button>}
              {r.status === 'hidden' && <Button size="sm" variant="outline" className="mt-4" onClick={() => updateStatus(r.id, 'approved')}>Approve Review</Button>}
            </div>
          ))}
          {totalPages > 1 && <div className="flex items-center justify-between border-t border-ink-100 pt-3"><p className="text-xs text-ink-500">Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, totalCount)} of {totalCount}</p><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
        </div>
      )}
    </div>
  );
}
