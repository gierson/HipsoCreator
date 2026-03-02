/**
 * HeightmapLoader — loads a grayscale image and converts it to heightmap data.
 */
export class HeightmapLoader {
    /**
     * Load a grayscale image file and return a Float32Array of normalized height values [0,1].
     * The result is resampled to targetResolution × targetResolution.
     */
    static async load(file: File, targetResolution: number): Promise<Float32Array> {
        const img = await HeightmapLoader.loadImage(file);
        const canvas = document.createElement('canvas');
        canvas.width = targetResolution;
        canvas.height = targetResolution;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(img, 0, 0, targetResolution, targetResolution);
        const imageData = ctx.getImageData(0, 0, targetResolution, targetResolution);
        const pixels = imageData.data;

        const heightData = new Float32Array(targetResolution * targetResolution);
        for (let i = 0; i < heightData.length; i++) {
            // Use luminance: average of R, G, B
            const r = pixels[i * 4];
            const g = pixels[i * 4 + 1];
            const b = pixels[i * 4 + 2];
            heightData[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        }

        return heightData;
    }

    private static loadImage(file: File): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = reader.result as string;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}
