import type { ReactNode } from 'react';
import { Field as UiField, Modal as UiModal, StatusBadge, type Tone } from '@/ui';
import s from './hr.module.css';

export const formatMoney = (v?: number) =>
  `Rs. ${(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString() : '—');

/** HR status → badge colour. (Kept separate from the app-wide map because HR uses its own vocabulary.) */
export const statusTone = (status: string | null | undefined): Tone => {
  switch (status) {
    case 'Active': case 'Approved': case 'Paid': case 'Completed': case 'Done': case 'Present': case 'Open': case 'Acknowledged': case 'Enrolled':
      return 'success';
    case 'Rejected': case 'Terminated': case 'Cancelled': case 'Failed': case 'Absent': case 'Urgent':
      return 'danger';
    case 'Pending': case 'Draft': case 'OnProbation': case 'InProgress': case 'Late': case 'Important': case 'NoShow':
      return 'warning';
    case 'Submitted': case 'Scheduled': case 'OnLeave': case 'HalfDay':
      return 'info';
    default:
      return 'neutral';
  }
};

export function Badge({ status, label }: { status: string | null | undefined; label?: string }) {
  return <StatusBadge status={status} label={label} tone={statusTone(status)} />;
}

/**
 * Header row of an HR view. HRModulePage already shows the view's title as the page heading, so the
 * title here is for screen readers only; the row shows the subtitle (usually a count) and the actions.
 */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  if (!subtitle && !action) return <h2 className="sr-only">{title}</h2>;
  return (
    <div className={s.topBar}>
      <div>
        <h2 className="sr-only">{title}</h2>
        {subtitle && <p className={s.headerSub}>{subtitle}</p>}
      </div>
      {action && <div className={s.headerActions}>{action}</div>}
    </div>
  );
}

/** Filter/toolbar card that sits above tables. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className={s.filterBar}>{children}</div>;
}

/** A labelled form control: the kit Field, so the label is linked to the Input/Select/Textarea inside it. */
export function Field({ label, required, children, full, className }: { label?: string; required?: boolean; children: ReactNode; full?: boolean; className?: string }) {
  return (
    <UiField label={label ?? ''} hideLabel={!label} required={required} className={`${s.fieldGroup} ${full ? s.fullWidth : ''} ${className || ''}`}>
      {children}
    </UiField>
  );
}

/**
 * HR dialog: the app's Modal (focus trap, Esc to close, scroll lock) with the HR sizes.
 * Callers render it conditionally, so it is always open while mounted.
 */
export function Modal({ title, children, onClose, footer, size }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'narrow' | 'wide';
}) {
  return (
    <UiModal open onClose={onClose} title={title} footer={footer} size={size === 'wide' ? 'lg' : size === 'narrow' ? 'sm' : 'md'}>
      <div className={s.modalContent}>{children}</div>
    </UiModal>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className={s.emptyRow}><span className={s.emptyRowText}>{text}</span></td>
    </tr>
  );
}
