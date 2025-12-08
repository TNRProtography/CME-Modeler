import { CMEEvent } from '../types';

export const sampleEvents: CMEEvent[] = [
  {
    id: 'cme-001',
    name: 'Fast Halo Event',
    launch: '2024-03-23T14:10Z',
    speed: 2100,
    density: 32,
    kpIndex: 7,
    arrival: '2024-03-24T21:45Z',
    notes: 'Wide halo CME with strong deceleration and moderate magnetic field rotation.',
  },
  {
    id: 'cme-002',
    name: 'Equatorial Eruption',
    launch: '2024-04-08T09:55Z',
    speed: 1400,
    density: 20,
    kpIndex: 6,
    arrival: '2024-04-09T22:15Z',
    notes: 'Mid-latitude launch with persistent speed beyond 0.5 AU.',
  },
  {
    id: 'cme-003',
    name: 'Slow Stream Interaction',
    launch: '2024-05-12T03:40Z',
    speed: 850,
    density: 14,
    kpIndex: 4,
    arrival: '2024-05-13T17:05Z',
    notes: 'Compression from background solar wind increased density near arrival.',
  },
  {
    id: 'cme-004',
    name: 'Polar Crown Filament',
    launch: '2024-06-02T18:20Z',
    speed: 980,
    density: 11,
    kpIndex: 3,
    arrival: '2024-06-04T09:30Z',
    notes: 'Narrow profile with mild shock signature; limited geomagnetic impact.',
  },
];
