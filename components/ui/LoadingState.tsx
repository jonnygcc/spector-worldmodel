export default function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-10 h-10 border-4 border-dark-border border-t-cyan rounded-full animate-spin mb-4" />
      <p className="text-gray-text text-sm">Simulating user journey...</p>
      <p className="text-gray-text text-xs mt-1">This may take a few seconds</p>
    </div>
  );
}