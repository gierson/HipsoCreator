import { jsPDF } from 'jspdf';
import { TerrainMesh } from '../terrain/TerrainMesh';
import { marchingSquares } from '../utils/MarchingSquares';
import { processContours } from '../utils/ContourUtils';
import type { Contour } from '../utils/MarchingSquares';

export interface ExportOptions {
    format: 'pdf' | 'png';
    paperSize: 'a4' | 'a3';
    scale: '1' | 'fit';
    showGrid: boolean;
    terrainWidthMM: number;
    terrainDepthMM: number;
    terrainHeightMM: number;
    layerThicknessMM: number;
}

// Paper sizes in mm
const PAPER_SIZES = {
    a4: { w: 210, h: 297 },
    a3: { w: 297, h: 420 },
};

export class LayerExporter {
    private terrain: TerrainMesh;

    constructor(terrain: TerrainMesh) {
        this.terrain = terrain;
    }

    /**
     * Get processed contours for a layer:
     * Marching Squares → Douglas-Peucker → Chaikin smoothing
     */
    private getContours(layerIdx: number): Contour[] {
        const res = this.terrain.resolution;
        const n = this.terrain.layerCount;
        const threshold = layerIdx / n;

        const raw = marchingSquares(this.terrain.heightData, res, res, threshold);
        // DP epsilon: 0.5 grid units; Chaikin iterations: 3
        return processContours(raw, 0.5, 3);
    }

    /**
     * Draw a closed smooth contour polygon on a 2D canvas context.
     * Applies fill + stroke for a clean cutting template look.
     */
    private drawContours(
        ctx: CanvasRenderingContext2D,
        contours: Contour[],
        offsetX: number,
        offsetY: number,
        scaleX: number,
        scaleY: number,
        color: string,
        forExport: boolean
    ) {
        // Fill: very light tint of the layer color so the cut area is readable
        const hexToRgba = (hex: string, alpha: number): string => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        };

        // Fill pass (very light, non-distracting)
        ctx.fillStyle = hexToRgba(color.length === 7 ? color : '#888888', 0.08);
        for (const contour of contours) {
            if (contour.length < 3) continue;
            ctx.beginPath();
            ctx.moveTo(offsetX + contour[0].x * scaleX, offsetY + contour[0].y * scaleY);
            for (let i = 1; i < contour.length; i++) {
                ctx.lineTo(offsetX + contour[i].x * scaleX, offsetY + contour[i].y * scaleY);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Stroke pass (solid contour line)
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = forExport ? 0.8 : 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (const contour of contours) {
            if (contour.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(offsetX + contour[0].x * scaleX, offsetY + contour[0].y * scaleY);
            for (let i = 1; i < contour.length; i++) {
                ctx.lineTo(offsetX + contour[i].x * scaleX, offsetY + contour[i].y * scaleY);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }

    /** Draw a single layer on a 2D canvas — contour only, no fill */
    drawLayerOnCanvas(
        ctx: CanvasRenderingContext2D,
        canvasW: number,
        canvasH: number,
        layerIdx: number,
        opts: ExportOptions,
        forExport = false
    ) {
        const res = this.terrain.resolution;
        const n = this.terrain.layerCount;

        // Clear
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasW, canvasH);

        // Grid
        if (opts.showGrid) {
            ctx.strokeStyle = '#e8e8e8';
            ctx.lineWidth = 0.2;
            const gridStep = forExport ? 10 : 20;
            for (let x = 0; x < canvasW; x += gridStep) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvasH);
                ctx.stroke();
            }
            for (let y = 0; y < canvasH; y += gridStep) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvasW, y);
                ctx.stroke();
            }
        }

        // Calculate scale and offset
        const margin = forExport ? 15 : 10;
        const footerH = forExport ? 25 : 20;
        const availW = canvasW - margin * 2;
        const availH = canvasH - margin * 2 - footerH;

        let scale: number;
        if (opts.scale === '1' && forExport) {
            scale = 1;
        } else {
            const scaleX = availW / opts.terrainWidthMM;
            const scaleY = availH / opts.terrainDepthMM;
            scale = Math.min(scaleX, scaleY);
        }

        const imgW = Math.ceil(opts.terrainWidthMM * scale);
        const imgH = Math.ceil(opts.terrainDepthMM * scale);
        const offsetX = margin + (availW - imgW) / 2;
        const offsetY = margin + (availH - imgH) / 2;

        // Terrain outline (dashed border)
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(offsetX, offsetY, imgW, imgH);
        ctx.setLineDash([]);

        // Crosshair marks in corners
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 0.5;
        const markLen = forExport ? 6 : 4;
        const corners = [
            [offsetX, offsetY],
            [offsetX + imgW, offsetY],
            [offsetX, offsetY + imgH],
            [offsetX + imgW, offsetY + imgH],
        ];
        for (const [cx, cy] of corners) {
            ctx.beginPath();
            ctx.moveTo(cx - markLen, cy);
            ctx.lineTo(cx + markLen, cy);
            ctx.moveTo(cx, cy - markLen);
            ctx.lineTo(cx, cy + markLen);
            ctx.stroke();
        }

        // Draw contours: MS → DP → Chaikin → canvas
        const color = this.terrain.layerColors[layerIdx] || '#888888';
        const scaleXGrid = (opts.terrainWidthMM * scale) / (res - 1);
        const scaleYGrid = (opts.terrainDepthMM * scale) / (res - 1);

        const contours = this.getContours(layerIdx);
        this.drawContours(ctx, contours, offsetX, offsetY, scaleXGrid, scaleYGrid, color, forExport);

        // ── Footer ──────────────────────────────────────────────────────────
        const footerY = canvasH - margin;
        const minHmm = ((layerIdx / n) * opts.terrainHeightMM).toFixed(1);
        const maxHmm = (((layerIdx + 1) / n) * opts.terrainHeightMM).toFixed(1);
        const labelFont = forExport ? '8px sans-serif' : '11px JetBrains Mono, monospace';
        const labelFontSmall = forExport ? '6.5px sans-serif' : '9px JetBrains Mono, monospace';

        // Layer name + height range
        ctx.fillStyle = '#222';
        ctx.font = labelFont;
        ctx.textAlign = 'left';
        ctx.fillText(`Warstwa ${layerIdx + 1} / ${n}`, margin, footerY - 8);
        ctx.font = labelFontSmall;
        ctx.fillStyle = '#666';
        ctx.fillText(`Wysokość: ${minHmm}–${maxHmm} mm`, margin, footerY);

        // Color swatch + hex
        const swatchW = forExport ? 30 : 24;
        const swatchH = forExport ? 12 : 10;
        const swatchX = canvasW - margin - swatchW;
        const swatchY = footerY - swatchH - 4;

        ctx.fillStyle = color;
        ctx.fillRect(swatchX, swatchY, swatchW, swatchH);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(swatchX, swatchY, swatchW, swatchH);

        ctx.fillStyle = '#333';
        ctx.font = labelFontSmall;
        ctx.textAlign = 'right';
        ctx.fillText(color.toUpperCase(), swatchX - 4, swatchY + swatchH - 1);
    }

    /** Export layers to PDF (multi-page) with page numbers */
    async exportPDF(opts: ExportOptions): Promise<void> {
        const paper = PAPER_SIZES[opts.paperSize];
        const pdf = new jsPDF({
            orientation: paper.w > paper.h ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [paper.w, paper.h],
        });

        const n = this.terrain.layerCount;

        const canvas = document.createElement('canvas');
        const dpi = 4;
        canvas.width = paper.w * dpi;
        canvas.height = paper.h * dpi;
        const ctx = canvas.getContext('2d')!;

        for (let i = 0; i < n; i++) {
            if (i > 0) pdf.addPage([paper.w, paper.h]);

            ctx.save();
            ctx.scale(dpi, dpi);
            this.drawLayerOnCanvas(ctx, paper.w, paper.h, i, opts, true);
            ctx.restore();

            const dataUrl = canvas.toDataURL('image/png');
            pdf.addImage(dataUrl, 'PNG', 0, 0, paper.w, paper.h);

            // Page number centered at bottom
            pdf.setFontSize(7);
            pdf.setTextColor(150, 150, 150);
            pdf.text(
                `Strona ${i + 1} / ${n}`,
                paper.w / 2,
                paper.h - 5,
                { align: 'center' }
            );
        }

        pdf.save('hipsocreator-layers.pdf');
    }

    /** Export layers as individual PNG files */
    async exportPNG(opts: ExportOptions): Promise<void> {
        const paper = PAPER_SIZES[opts.paperSize];
        const dpi = 4;
        const canvas = document.createElement('canvas');
        canvas.width = paper.w * dpi;
        canvas.height = paper.h * dpi;
        const ctx = canvas.getContext('2d')!;

        const n = this.terrain.layerCount;

        for (let i = 0; i < n; i++) {
            ctx.save();
            ctx.scale(dpi, dpi);
            this.drawLayerOnCanvas(ctx, paper.w, paper.h, i, opts, true);
            ctx.restore();

            const blob = await new Promise<Blob>((resolve) => {
                canvas.toBlob((b) => resolve(b!), 'image/png');
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `layer-${String(i + 1).padStart(2, '0')}.png`;
            a.click();
            URL.revokeObjectURL(url);

            await new Promise(r => setTimeout(r, 200));
        }
    }
}
