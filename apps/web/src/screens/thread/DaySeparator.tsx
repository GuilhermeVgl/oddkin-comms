/** "Hoje" or the long date, above the first entry of a day. */
export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="daysep">
      <span>{label}</span>
    </div>
  );
}
