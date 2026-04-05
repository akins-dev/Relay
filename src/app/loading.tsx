export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="relative flex items-center justify-center">
        {/* Outer ring */}
        <div className="h-10 w-10 rounded-full border border-white/10 animate-[spin_2s_linear_infinite]
                        border-t-white/60" />
        {/* Inner dot */}
        <div className="absolute h-2 w-2 rounded-full bg-[#06B6D4] animate-[pulse_1.5s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
