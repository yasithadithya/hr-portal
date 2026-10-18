import PDFDocument from 'pdfkit';

import type { PayslipDetail } from '@hr/shared';
import { money } from '@hr/shared/money';

/**
 * Payslip PDF (PDFKit, tenant branding = company name + brand colour). Optional password
 * (tenant setting `payroll.payslip_password`: NIC or date of birth). Built in memory.
 */
export interface PdfBranding {
  companyName: string;
  address: string | null;
  color: string | null;
}

const fmt = (v: string) =>
  money(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function payslipPdf(
  p: PayslipDetail,
  brand: PdfBranding,
  opts: { password?: string | null; nic?: string | null; epfNo?: string | null },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Payslip ${p.month} ${p.employeeNo}`, Author: brand.companyName },
      ...(opts.password
        ? {
            userPassword: opts.password,
            ownerPassword: `${opts.password}:${p.id}`,
            pdfVersion: '1.7' as const,
            permissions: { printing: 'highResolution' as const, copying: false, modifying: false },
          }
        : {}),
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = brand.color ?? '#111827';
    const width = doc.page.width - 96;
    doc.rect(48, 40, width, 4).fill(accent);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16).text(brand.companyName, 48, 56);
    if (brand.address) doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(brand.address);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(accent)
      .text(
        `Payslip — ${p.month}${p.runType !== 'regular' ? ` (${p.runType.replace('_', ' ')})` : ''}`,
        48,
        100,
      );

    doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor('#111827');
    const info: [string, string][] = [
      ['Employee', `${p.employeeName} (${p.employeeNo})`],
      ['Department', p.department ?? '—'],
      ['NIC', opts.nic ?? '—'],
      ['EPF no', opts.epfNo ?? '—'],
      ['Pay date', p.payDate],
    ];
    for (const [k, v] of info) {
      const y = doc.y;
      doc.fillColor('#6b7280').text(k, 48, y, { width: 100 });
      doc.fillColor('#111827').text(v, 150, y);
    }

    const section = (title: string, kinds: string[]) => {
      const rows = p.lines.filter((l) => kinds.includes(l.kind) && !money(l.amount).isZero());
      if (!rows.length) return;
      doc.moveDown(0.8).font('Helvetica-Bold').fillColor(accent).text(title, 48);
      doc
        .moveTo(48, doc.y + 2)
        .lineTo(48 + width, doc.y + 2)
        .strokeColor('#e5e7eb')
        .stroke();
      doc.moveDown(0.3).font('Helvetica').fillColor('#111827');
      for (const l of rows) {
        const y = doc.y;
        const qty = l.quantity && l.rate ? `  (${l.quantity} × ${fmt(l.rate)})` : '';
        doc.text(`${l.name}${qty}`, 48, y, { width: width - 120 });
        doc.text(fmt(l.amount), 48 + width - 120, y, { width: 120, align: 'right' });
      }
    };
    section('Earnings', ['earning']);
    section('Deductions', ['deduction']);

    doc.moveDown(0.8);
    const totals: [string, string][] = [
      ['Gross earnings', p.gross],
      ['Total deductions', p.deductions],
    ];
    for (const [k, v] of totals) {
      const y = doc.y;
      doc.font('Helvetica').text(k, 48, y);
      doc.text(fmt(v), 48 + width - 120, y, { width: 120, align: 'right' });
    }
    const y = doc.y + 6;
    doc.rect(48, y, width, 24).fill('#f3f4f6');
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Net pay', 56, y + 6);
    doc.text(`LKR ${fmt(p.net)}`, 48 + width - 168, y + 6, { width: 160, align: 'right' });

    section('Employer contributions (not deducted from you)', ['employer_contribution']);
    doc
      .moveDown(2)
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(
        `EPF base ${fmt(p.bases.epf)} · ETF base ${fmt(p.bases.etf)} · APIT base ${fmt(p.bases.apit)}`,
        48,
      )
      .text('This is a computer-generated payslip and needs no signature.');
    doc.end();
  });
}
