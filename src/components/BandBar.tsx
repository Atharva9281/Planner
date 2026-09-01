/**
 * A position drawn against its own band.
 *
 * The shaded zone between the two ticks is the band, floor to ceiling. The solid marker is where
 * the holding actually sits; the ring is where the proposed trade would land it. Executing that
 * trade slides the marker onto the ring, so the change is something you watch rather than
 * something you work out from two numbers.
 *
 * The domain stretches to include the marker whenever a weight sits outside its band, and the
 * overshoot is tinted, so a breach shows its size rather than pinning silently to the end.
 */
export default function BandBar({
  bandMin,
  bandMax,
  weight,
  goalWeight,
  breached,
  className = '',
}: {
  bandMin: number;
  bandMax: number;
  weight: number;
  /** Where the lot-aware target would put this holding. Omitted when there is nothing to do. */
  goalWeight?: number;
  breached: boolean;
  className?: string;
}) {
  const points = [bandMin, bandMax, weight, ...(goalWeight === undefined ? [] : [goalWeight])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo || 1) * 0.12;
  const from = lo - pad;
  const to = hi + pad;

  const at = (v: number) => Math.max(0, Math.min(100, ((v - from) / (to - from)) * 100));

  const bandLeft = at(bandMin);
  const bandRight = at(bandMax);
  const here = at(weight);
  // Below about four percent of the track the ring collides with the marker and reads as a
  // rendering fault. The move is still stated in figures beside the bar.
  const showGoal = goalWeight !== undefined && Math.abs(at(goalWeight) - here) > 4;

  // When the weight is outside the band, shade the gap between the breached edge and the marker.
  const over = weight > bandMax;
  const overshoot = breached
    ? over
      ? { left: bandRight, width: here - bandRight }
      : { left: here, width: bandLeft - here }
    : null;

  return (
    <div
      className={`relative h-5 w-32 ${className}`}
      role="img"
      aria-label={
        `${weight.toFixed(2)}% against a ${bandMin}–${bandMax}% band` +
        (showGoal ? `, target ${goalWeight!.toFixed(2)}%` : '')
      }
    >
      {/* the full domain */}
      <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-line" />

      {/* the band */}
      <div
        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px] bg-accent/12"
        style={{ left: `${bandLeft}%`, width: `${Math.max(bandRight - bandLeft, 1)}%` }}
      />

      {/* how far past the band the position sits */}
      {overshoot && overshoot.width > 0.4 && (
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 bg-sell/20"
          style={{ left: `${overshoot.left}%`, width: `${overshoot.width}%` }}
        />
      )}

      {/* floor and ceiling */}
      {[bandLeft, bandRight].map((x, i) => (
        <div
          key={i}
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-accent/45"
          style={{ left: `${x}%` }}
        />
      ))}

      {/* where the proposed trade lands */}
      {showGoal && (
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full
                     border-[1.5px] border-accent bg-panel transition-[left] duration-500 ease-out"
          style={{ left: `${at(goalWeight!)}%` }}
        />
      )}

      {/* where it sits now */}
      <div
        className={`absolute top-1/2 h-[17px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full
                    ring-2 ring-panel transition-[left,background-color] duration-500 ease-out
                    ${breached ? 'bg-sell' : 'bg-ink'}`}
        style={{ left: `${here}%` }}
      />
    </div>
  );
}
