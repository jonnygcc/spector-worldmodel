import GoalForm from "@/components/ui/GoalForm";

export default function Home() {
  return (
    <div className="flex flex-col items-center py-12">
      <div className="mb-2 text-sm font-medium tracking-widest uppercase text-cyan">
        UX Journey Predictor
      </div>

      <h1 className="font-heading text-5xl font-bold mb-4 leading-tight text-center">
        Find the best path<br />
        <span className="text-cyan">to any goal</span>
      </h1>

      <p className="text-gray-text max-w-xl mb-12 text-lg text-center">
        Spector simulates how real users move through your site, then walks
        the most likely routes in a real browser to see what actually happens.
      </p>

      <GoalForm />
    </div>
  );
}