// Where the month's money went, as one picture (2026-11-27; the owner picked it from a list of what
// Monarch has that Ledger lacked). Money in on the left, by where it came from; one bar in the middle for
// all of it; and on the right each kind of spending, with what was left over. Each band is as thick as its
// amount, so the big things are the wide ones.
//
// Drawn by hand as SVG in real pixels (the card's own width is measured), so the lettering stays the same
// size on a phone and on a wide screen. Nothing moves.
import { useEffect, useRef, useState } from 'react';
import { money, periodLong, useData } from '../lib';

type Node = { name: string; amount: number; color: string; y?: number; h?: number };

const INK_IN = 'var(--good, #2e9e6b)';
const LEFT_OVER = 'var(--good, #2e9e6b)';
const SHORT = 'var(--series2, #d98a2b)';
const REST = 'var(--ink3, #8d8d97)';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.floor(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === 'undefined') { addEventListener('resize', read); return () => removeEventListener('resize', read); }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Stacks nodes down a column: each as tall as its share, never thinner than a sliver, with gaps between. */
function stack(nodes: Node[], total: number, top: number, height: number, gap: number) {
  const room = height - gap * Math.max(0, nodes.length - 1);
  const scale = total > 0 ? room / total : 0;
  let y = top;
  for (const n of nodes) { n.h = Math.max(2, n.amount * scale); n.y = y; y += n.h + gap; }
  // Slivers were given a little extra, so squeeze the whole column back into its space if it ran over.
  const over = y - gap - (top + height);
  if (over > 0) { const k = height / (height + over); let yy = top; for (const n of nodes) { n.h = n.h! * k; n.y = yy; yy += n.h + gap * k; } }
  return nodes;
}

export function FlowCard({ months, who }: { months: string[]; who: string }) {
  const [month, setMonth] = useState(months[months.length - 1] || new Date().toISOString().slice(0, 7));
  useEffect(() => { if (months.length && !months.includes(month)) setMonth(months[months.length - 1]); }, [months.join(',')]);
  const { data } = useData<any>(`/api/reports/flow?month=${month}${who ? `&who=${who}` : ''}`);
  const [ref, width] = useWidth();

  let body: React.ReactNode = null;
  if (data && width > 0) {
    const ins: Node[] = data.income.map((x: any) => ({ name: x.name, amount: x.amount, color: INK_IN }));
    if (data.short > 0) ins.push({ name: 'From what you already had', amount: data.short, color: SHORT });
    // Eight kinds of spending by name, the rest together, so the right-hand side stays readable.
    const spend: any[] = data.spending;
    const outs: Node[] = spend.slice(0, 8).map((x) => ({ name: x.name, amount: x.amount, color: x.color || REST }));
    const rest = spend.slice(8).reduce((a, x) => a + x.amount, 0);
    if (rest > 0) outs.push({ name: `${spend.length - 8} more`, amount: rest, color: REST });
    if (data.left > 0) outs.push({ name: 'Left over', amount: data.left, color: LEFT_OVER });
    const total = ins.reduce((a, n) => a + n.amount, 0);

    if (total <= 0 || !outs.length) body = <p className="sub">Nothing came in or went out in {periodLong(month)}{who ? ' on these accounts' : ''}.</p>;
    else {
      const narrow = width < 520;
      const bar = narrow ? 8 : 12, gap = narrow ? 7 : 9, pad = 6;
      const H = Math.max(narrow ? 300 : 340, outs.length * (narrow ? 34 : 38));
      const xL = 0, xM = Math.round(width * (narrow ? 0.4 : 0.42)), xR = width - bar;
      stack(ins, total, pad, H - pad * 2, gap);
      stack(outs, total, pad, H - pad * 2, gap);
      const mid = { y: pad, h: H - pad * 2 };
      // A band from one bar to another: a filled shape whose top and bottom edges are gentle S-curves.
      const band = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
        const c = (x0 + x1) / 2;
        return `M${x0},${y0} C${c},${y0} ${c},${y1} ${x1},${y1} L${x1},${y1 + h1} C${c},${y1 + h1} ${c},${y0 + h0} ${x0},${y0 + h0} Z`;
      };
      // Where each band lands on the middle bar: in order, each taking its share of the bar's height.
      let at = mid.y;
      const inBands = ins.map((n) => { const h = (n.amount / total) * mid.h; const d = band(xL + bar, n.y!, n.h!, xM, at, h); at += h; return { n, d }; });
      at = mid.y;
      const outBands = outs.map((n) => { const h = (n.amount / total) * mid.h; const d = band(xM + bar, at, h, xR, n.y!, n.h!); at += h; return { n, d }; });
      const label = (n: Node) => `${n.name} ${money(n.amount)}`;
      const fs = narrow ? 11.5 : 13;
      body = (
        <svg className="flow" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
          aria-label={`Money in and out for ${periodLong(month)}: ${money(total)} in. ${outs.map(label).join(', ')}.`}>
          {inBands.map(({ n, d }, i) => <path key={`i${i}`} d={d} fill={n.color} opacity={0.22}><title>{label(n)}</title></path>)}
          {outBands.map(({ n, d }, i) => <path key={`o${i}`} d={d} fill={n.color} opacity={0.3}><title>{label(n)}</title></path>)}
          {ins.map((n, i) => <rect key={`il${i}`} x={xL} y={n.y} width={bar} height={n.h} rx={3} fill={n.color} />)}
          <rect x={xM} y={mid.y} width={bar} height={mid.h} rx={3} fill="var(--ink2)" />
          {outs.map((n, i) => <rect key={`ol${i}`} x={xR} y={n.y} width={bar} height={n.h} rx={3} fill={n.color} />)}
          {ins.map((n, i) => (
            <text key={`it${i}`} x={xL + bar + 6} y={n.y! + Math.min(n.h! / 2, 22) + fs / 3} fontSize={fs} className="flow-label">
              <tspan className="flow-name">{n.name}</tspan><tspan x={xL + bar + 6} dy={fs + 2} className="flow-amount">{money(n.amount)}</tspan>
            </text>
          ))}
          {outs.map((n, i) => (
            <text key={`ot${i}`} x={xR - 6} y={n.y! + n.h! / 2 + fs / 3} fontSize={fs} textAnchor="end" className="flow-label">
              <tspan className="flow-name">{n.name}</tspan> <tspan className="flow-amount">{money(n.amount)}</tspan>
            </text>
          ))}
        </svg>
      );
    }
  }

  const said = data ? (data.left > 0
    ? `${money(data.in)} came in and ${money(data.out)} went out, leaving ${money(data.left)}.`
    : data.short > 0 ? `${money(data.in)} came in and ${money(data.out)} went out: ${money(data.short)} more than came in, which came from money you already had.`
    : `${money(data.in)} came in and the same went out.`) : '';

  return (
    <section className="card flow-card" data-go="flow">
      <div className="card-head">
        <h2>Where the money went</h2>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {[...months].reverse().map((m) => <option key={m} value={m}>{periodLong(m)}</option>)}
        </select>
      </div>
      {data && <p className="sub first">{said} Each band is as thick as its amount.</p>}
      <div ref={ref} className="flow-wrap">{body}</div>
      <p className="sub">Money in is what was filed as income. Transfers between your own accounts, and anything left out of the budget, are not shown.</p>
    </section>
  );
}
