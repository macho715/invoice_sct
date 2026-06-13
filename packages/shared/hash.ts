import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Buffer(input: Buffer | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashField(value: string, prefix: string = 'HASH'): string {
  return `${prefix}:${sha256Hex(value).slice(0, 16)}`;
}

export function hashVendorId(vendorName: string): string {
  return hashField(vendorName, 'VENDOR');
}

export function hashInvoiceNo(invoiceNo: string): string {
  return hashField(invoiceNo, 'INV');
}

export function hashBlNumber(blNumber: string): string {
  return hashField(blNumber, 'BL');
}

export function hashContainerNumber(containerNo: string): string {
  return hashField(containerNo, 'CONT');
}
