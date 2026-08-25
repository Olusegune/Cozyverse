/** Drop-in replacement for a plain `<input type="range">` — same controlled-value API, but with a
 * real two-tone gold-fill-to-thumb track (computed live from the current value) and a bigger,
 * rounded, glowing thumb, styled globally via the .cvs-slider rules in styles.css. Native
 * <input type="range"> keeps full keyboard/drag/accessibility behavior; only its paint is replaced. */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled,
  className = "",
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`cvs-slider ${className}`}
      style={{ background: `linear-gradient(to right, #e0a034 ${percent}%, #3a363f ${percent}%)` }}
    />
  );
}
