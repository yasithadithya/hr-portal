import path from 'path';
import crypto from 'crypto';

export const imageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const documentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const mimeToExtension = (mimetype: string): string => {
  switch (mimetype) {
    case 'application/pdf': return '.pdf';
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    case 'application/msword': return '.doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return '.docx';
    case 'application/vnd.ms-excel': return '.xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return '.xlsx';
    default: return '';
  }
};

export const buildHrObjectKey = (originalname: string, mimetype: string, prefix: string): string => {
  const extension = (path.extname(originalname) || mimeToExtension(mimetype)).toLowerCase();
  const fileId = crypto.randomUUID();
  const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]+/g, '-').replace(/^\/+|\/+$/g, '');
  return `${safePrefix}/${fileId}${extension}`;
};
