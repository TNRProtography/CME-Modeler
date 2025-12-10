export const getCarringtonLongitude = (date: Date): number => {
  const jd = date.getTime() / 86400000 + 2440587.5; // convert to Julian Day
  const rotation = (jd - 2398140.2270) / 27.2753; // Carrington rotation count
  const fractional = rotation - Math.floor(rotation);
  const longitude = (fractional * 360 + 360) % 360; // normalize 0-360
  return longitude;
};

export const angularSeparationDeg = (a: number, b: number): number => {
  const diff = ((a - b + 540) % 360) - 180;
  return Math.abs(diff);
};
