import React from "react";
import Svg, { Path } from "react-native-svg";

interface IconProps {
  size: number;
  color: string;
  filled: boolean;
}

// Inline SVG, not an icon font (@expo/vector-icons/Ionicons) - see
// project_hereby_ionicons_black_screen memory: font-glyph rendering
// black-screened production builds on this SDK 54 project, an unresolved
// upstream issue. Same shape rendered filled (selected) or outline-only
// (unselected) via fill vs stroke, rather than needing two separate paths.
function ThumbPath({ size, color, filled, d }: IconProps & { d: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} fill={filled ? color : "none"} stroke={filled ? "none" : color} strokeWidth={filled ? 0 : 1.6} />
    </Svg>
  );
}

const THUMB_UP_PATH =
  "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";

const THUMB_DOWN_PATH =
  "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z";

const REPLY_PATH = "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z";

export function ThumbsUpIcon(props: IconProps) {
  return <ThumbPath {...props} d={THUMB_UP_PATH} />;
}

export function ThumbsDownIcon(props: IconProps) {
  return <ThumbPath {...props} d={THUMB_DOWN_PATH} />;
}

export function ReplyIcon({ size, color }: Omit<IconProps, "filled">) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={REPLY_PATH} fill={color} />
    </Svg>
  );
}
