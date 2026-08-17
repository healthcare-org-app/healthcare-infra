export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="healthcare-org"
    >
      <defs>
        <linearGradient id="hcg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#hcg)" />
      <path
        d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5V8z"
        fill="white"
      />
    </svg>
  );
}
