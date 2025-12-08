import { CMEEvent } from '../types';

interface Props {
  events: CMEEvent[];
}

export function EventTable({ events }: Props) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Reference gallery</p>
          <h2>Curated CME cases</h2>
        </div>
        <div className="legend-note">Compare your scenario with past events modeled below.</div>
      </div>
      <div className="event-grid">
        {events.map((event) => (
          <article key={event.id} className="event-card">
            <header>
              <div>
                <div className="helper">{event.launch}</div>
                <h3>{event.name}</h3>
              </div>
              <span className="tag">Kp {event.kpIndex}</span>
            </header>
            <p className="helper">{event.notes}</p>
            <dl>
              <div>
                <dt>Speed</dt>
                <dd>{event.speed} km/s</dd>
              </div>
              <div>
                <dt>Density</dt>
                <dd>{event.density} p/cm³</dd>
              </div>
              <div>
                <dt>Arrival</dt>
                <dd>{event.arrival}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
