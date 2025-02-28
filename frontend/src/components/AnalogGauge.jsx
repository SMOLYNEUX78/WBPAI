// src/components/AnalogGauge.jsx
import React from "react";

// Convert polar coordinates to Cartesian coordinates.
const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
};

// Describe an arc path for SVG.
const describeArc = (x, y, radius, startAngle, endAngle) => {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
};

const AnalogGauge = ({ value }) => {
  const cx = 100;
  const cy = 100;
  const radius = 80;
  
  // Map value (0-100) to an angle between -90 and 90.
  const angle = -90 + (value / 100) * 180;
  
  // Define arcs for three zones:
  const redArc = describeArc(cx, cy, radius, -90, -30);     // 0-33%
  const amberArc = describeArc(cx, cy, radius, -30, 30);      // 33-66%
  const greenArc = describeArc(cx, cy, radius, 30, 90);       // 66-100%
  
  // Needle: from center to circumference at the computed angle.
  const needleLength = radius - 10;
  const needleEnd = polarToCartesian(cx, cy, needleLength, angle);
  
  return (
    <svg width="200" height="120" viewBox="0 0 200 120">
      {/* Draw colored arcs */}
      <path d={redArc} stroke="#f87171" strokeWidth="10" fill="none" />
      <path d={amberArc} stroke="#facc15" strokeWidth="10" fill="none" />
      <path d={greenArc} stroke="#4ade80" strokeWidth="10" fill="none" />
      
      {/* Draw needle */}
      <line
        x1={cx}
        y1={cy}
        x2={needleEnd.x}
        y2={needleEnd.y}
        stroke="#1f2937"
        strokeWidth="4"
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="5" fill="#1f2937" />
    </svg>
  );
};

export default AnalogGauge;

