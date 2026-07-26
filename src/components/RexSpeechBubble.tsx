import Rex from "./Rex";

interface RexSpeechBubbleProps {
  message: string;
  mood?: "happy" | "excited" | "encouraging";
}

export default function RexSpeechBubble({ message, mood = "happy" }: RexSpeechBubbleProps) {
  return (
    <div className="flex items-end gap-3 animate-[fadeIn_0.4s_ease-out]">
      <Rex className="w-14 h-14 flex-shrink-0" mood={mood} />
      <div className="relative bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-md max-w-xs">
        <p className="text-sm text-darkText leading-snug">{message}</p>
        {/* Speech triangle */}
        <div className="absolute -left-2 bottom-3 w-0 h-0 border-t-8 border-t-transparent border-r-8 border-r-white border-b-8 border-b-transparent" />
      </div>
    </div>
  );
}
