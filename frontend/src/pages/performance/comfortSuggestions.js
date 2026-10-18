const FRESH_MS = 2 * 60 * 60 * 1000;

export const homeComfortSuggestion = (rooms, now = Date.now()) => {
  const fresh = (rooms || []).filter((room) => {
    const timestamp = Date.parse(room.timestamp || "");
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= FRESH_MS;
  });
  const humid = fresh.filter((room) => Number(room.humidity) >= 65 && Number(room.humidity) <= 100)
    .sort((a, b) => Number(b.humidity) - Number(a.humidity))[0];
  if (humid) {
    const temp = Number(humid.internalTemp);
    const cool = Number.isFinite(temp) && temp > 0 && temp < 19;
    return {
      key: "high-humidity",
      title: "Home comfort suggestion",
      bannerText: cool ? "Comfort: heating could be turned on" : "Comfort: check ventilation",
      message: `${humid.label} humidity is ${Math.round(Number(humid.humidity))}%${cool ? ` at ${temp.toFixed(1)}°C` : ""}. Check for condensation and use kitchen or bathroom extraction if needed. If the room feels cool, consider gentle heating as well as ventilation.`,
    };
  }
  const cold = fresh.filter((room) => Number(room.internalTemp) > 0 && Number(room.internalTemp) < 18)
    .sort((a, b) => Number(a.internalTemp) - Number(b.internalTemp))[0];
  if (cold) return { key: "cool-room", title: "Home comfort suggestion",
    bannerText: "Comfort: heating could be turned on",
    message: `${cold.label} is ${Number(cold.internalTemp).toFixed(1)}°C. Consider warming the room if it is occupied.` };
  return null;
};
