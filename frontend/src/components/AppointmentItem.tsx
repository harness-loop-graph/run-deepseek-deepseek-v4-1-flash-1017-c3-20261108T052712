import type { KeyboardEvent, ReactNode } from 'react';
import type { Appointment } from '../api/types';
import { STATUS_LABELS } from '../api/types';
import { formatDateTime } from '../utils/dates';

/**
 * One appointment row shared by SCR-02 and SCR-04.
 *
 * The testability contract fixes the element: `appointment-item` with the
 * `data-appointment-id` attribute. Actions (cancel, open) are passed in by the
 * screen so each SCR exposes exactly what its role may do.
 */
export function AppointmentItem({
  appointment,
  onOpen,
  children,
  showPatient = true,
  showProfessional = false,
}: {
  appointment: Appointment;
  onOpen?: () => void;
  children?: ReactNode;
  showPatient?: boolean;
  showProfessional?: boolean;
}): ReactNode {
  const open = onOpen;
  const interactiveProps =
    open === undefined
      ? {}
      : {
          role: 'button',
          tabIndex: 0,
          onClick: open,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          },
        };

  return (
    <article
      className={`appointment-item${open === undefined ? '' : ' appointment-item-clickable'}`}
      data-testid="appointment-item"
      data-appointment-id={appointment.id}
      {...interactiveProps}
    >
      <div className="appointment-main">
        <div className="appointment-when">
          <span className="appointment-time">{formatDateTime(appointment.start)}</span>
          <span className={`status status-${appointment.status}`}>
            {STATUS_LABELS[appointment.status]}
          </span>
        </div>
        <div className="appointment-who">
          {showPatient ? (
            <span>
              Patient: {appointment.patient.nombre} {appointment.patient.apellidos}
            </span>
          ) : null}
          {showProfessional ? (
            <span>
              {appointment.professional.nombre} {appointment.professional.apellidos} ·{' '}
              {appointment.professional.especialidad}
            </span>
          ) : null}
        </div>
      </div>
      {children === undefined ? null : <div className="appointment-actions">{children}</div>}
    </article>
  );
}
