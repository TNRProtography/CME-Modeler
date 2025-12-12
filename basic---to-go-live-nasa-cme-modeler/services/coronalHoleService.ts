export interface CoronalHolePoint {
  x: number;
  y: number;
}

export interface CoronalHoleResponse {
  status: string;
  source: string;
  timestamp: string;
  original_dimensions: {
    width: number;
    height: number;
  };
  processed_dimensions: {
    width: number;
    height: number;
    step: number;
  };
  polygon_count: number;
  coronal_holes_polygons: CoronalHolePoint[];
}

const CORONAL_HOLE_ENDPOINT = 'https://ch-locator.thenamesrock.workers.dev';

export const fetchCoronalHoleData = async (): Promise<CoronalHoleResponse> => {
  const response = await fetch(CORONAL_HOLE_ENDPOINT);
  if (!response.ok) {
    throw new Error(`Failed to fetch coronal hole data (${response.status})`);
  }
  const data: CoronalHoleResponse = await response.json();
  return data;
};

export const getCoronalHoleImageUrl = () => `${CORONAL_HOLE_ENDPOINT}/img`;
