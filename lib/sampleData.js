// Substation registry for the downtown Toronto power-grid telemetry stream.
// Each entry is a feeder node with a stable code + human-readable area name.
// Live load / surge / outage values are produced by the streaming simulator
// (see ./streaming.js) and merged with these spatial coordinates each tick.

export const DATASET_ID = 'grid_live';

export const FIELDS = [
  { name: 'code', format: '', type: 'string' },
  { name: 'node', format: '', type: 'string' },
  { name: 'lat', format: '', type: 'real' },
  { name: 'lng', format: '', type: 'real' },
  { name: 'load', format: '', type: 'integer' },
  { name: 'surge', format: '', type: 'integer' },
  { name: 'outage', format: '', type: 'integer' }
];

export const STATIONS_BASE = [
  // Core / Financial
  { code: 'TS-001', node: 'Financial District', lat: 43.6486, lng: -79.3814 },
  { code: 'TS-002', node: 'Bay Street Corridor', lat: 43.6534, lng: -79.3839 },
  { code: 'TS-003', node: 'PATH / Union', lat: 43.6453, lng: -79.3806 },
  { code: 'TS-004', node: 'Harbourfront', lat: 43.6385, lng: -79.3811 },
  { code: 'MS-005', node: 'CityPlace', lat: 43.6419, lng: -79.3925 },
  { code: 'TS-006', node: 'Entertainment District', lat: 43.6465, lng: -79.3893 },
  { code: 'TS-007', node: 'King West', lat: 43.6448, lng: -79.3987 },
  { code: 'MS-008', node: 'Liberty Village', lat: 43.6386, lng: -79.4202 },
  // Old Town / East Core
  { code: 'TS-009', node: 'St. Lawrence', lat: 43.6489, lng: -79.3717 },
  { code: 'MS-010', node: 'Old Town', lat: 43.6515, lng: -79.3711 },
  { code: 'MS-011', node: 'Distillery District', lat: 43.6503, lng: -79.3597 },
  { code: 'FN-012', node: 'Corktown', lat: 43.6560, lng: -79.3603 },
  { code: 'FN-013', node: 'Riverside', lat: 43.6597, lng: -79.3450 },
  { code: 'FN-014', node: 'Leslieville', lat: 43.6645, lng: -79.3358 },
  // Yonge spine
  { code: 'TS-015', node: 'Downtown Yonge', lat: 43.6555, lng: -79.3805 },
  { code: 'TS-016', node: 'Yonge-Dundas Sq.', lat: 43.6562, lng: -79.3804 },
  { code: 'MS-017', node: 'Garden District', lat: 43.6580, lng: -79.3758 },
  { code: 'FN-018', node: 'Moss Park', lat: 43.6586, lng: -79.3724 },
  { code: 'FN-019', node: 'Regent Park', lat: 43.6606, lng: -79.3637 },
  { code: 'FN-020', node: 'Cabbagetown', lat: 43.6678, lng: -79.3673 },
  { code: 'MS-021', node: 'Church-Wellesley', lat: 43.6651, lng: -79.3835 },
  { code: 'MS-022', node: 'Rosedale', lat: 43.6790, lng: -79.3809 },
  // West / arts
  { code: 'TS-023', node: 'Discovery District', lat: 43.6602, lng: -79.3893 },
  { code: 'TS-024', node: 'University', lat: 43.6629, lng: -79.3957 },
  { code: 'FN-025', node: 'Grange Park', lat: 43.6519, lng: -79.3936 },
  { code: 'MS-026', node: 'Chinatown', lat: 43.6532, lng: -79.3987 },
  { code: 'MS-027', node: 'Kensington Market', lat: 43.6547, lng: -79.4011 },
  { code: 'MS-028', node: 'Queen West', lat: 43.6479, lng: -79.4082 },
  { code: 'FN-029', node: 'Trinity-Bellwoods', lat: 43.6479, lng: -79.4148 },
  { code: 'MS-030', node: 'West Queen West', lat: 43.6432, lng: -79.4192 },
  { code: 'FN-031', node: 'Little Portugal', lat: 43.6479, lng: -79.4291 },
  { code: 'MS-032', node: 'Dundas West', lat: 43.6557, lng: -79.4365 },
  { code: 'FN-033', node: 'Dovercourt', lat: 43.6586, lng: -79.4307 },
  { code: 'FN-034', node: 'Parkdale', lat: 43.6385, lng: -79.4344 },
  { code: 'FN-035', node: 'Junction Triangle', lat: 43.6635, lng: -79.4427 },
  // North of Bloor
  { code: 'MS-036', node: 'Yorkville', lat: 43.6708, lng: -79.3893 },
  { code: 'MS-037', node: 'The Annex', lat: 43.6677, lng: -79.4060 },
  { code: 'FN-038', node: 'Koreatown', lat: 43.6649, lng: -79.4143 },
  { code: 'FN-039', node: 'Christie Pits', lat: 43.6648, lng: -79.4204 },
  { code: 'MS-040', node: 'Forest Hill (S)', lat: 43.6917, lng: -79.4156 },
  { code: 'MS-041', node: 'Greektown', lat: 43.6770, lng: -79.3517 }
];
