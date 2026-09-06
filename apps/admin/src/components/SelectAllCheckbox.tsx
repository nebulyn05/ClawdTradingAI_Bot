"use client";

/** Toggles every `.user-checkbox` in the form — kept as a tiny client component rather than an inline script. */
export function SelectAllCheckbox() {
  return (
    <label className="flex items-center gap-1 text-xs text-white/60">
      <input
        type="checkbox"
        className="accent-accent"
        onChange={(e) => {
          document
            .querySelectorAll<HTMLInputElement>(".user-checkbox")
            .forEach((el) => (el.checked = e.target.checked));
        }}
      />
      Select all
    </label>
  );
}
