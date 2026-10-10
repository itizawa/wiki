import { describe, expect, it } from "vitest";
import { imageNameFromPath, imageTypeOfName, newImageName, sniffImageType } from "./images";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("images", () => {
  it("tells the type from the content, not the name", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("makes random names that the image path accepts", () => {
    const name = newImageName("image/jpeg");
    expect(name).toMatch(/^[0-9a-z]{24}\.jpg$/);
    expect(newImageName("image/jpeg")).not.toBe(name);
    expect(imageNameFromPath(`/images/${name}`)).toBe(name);
    expect(imageTypeOfName(name)).toBe("image/jpeg");
    expect(imageNameFromPath("/images/../secret.png")).toBeNull();
    expect(imageNameFromPath(`/images/${name.replace(".jpg", ".svg")}`)).toBeNull();
  });
});
