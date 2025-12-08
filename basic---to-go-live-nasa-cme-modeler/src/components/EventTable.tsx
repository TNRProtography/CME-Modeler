import { CMEEvent } from '../types';

interface Props {
  events: CMEEvent[];
}

export function EventTable({ events }: Props) {
  return (
    <div className="panel">
      <h2>Recent modeled CMEs</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Launch</th>
            <th>Speed</th>
            <th>Density</th>
            <th>Kp est.</th>
            <th>Arrival</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <div style={{ fontWeight: 700 }}>{event.name}</div>
                <div className="helper">{event.notes}</div>
              </td>
              <td>{event.launch}</td>
              <td>{event.speed} km/s</td>
              <td>{event.density} p/cm³</td>
              <td>
                <span className="tag">Kp {event.kpIndex}</span>
              </td>
              <td>{event.arrival}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
