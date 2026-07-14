import sys
from pathlib import Path

from PIL import Image, ImageOps

MAX_LONG_EDGE_PIXELS = 1200
MAX_SEED_PHOTO_BYTES = 300 * 1024
WEBP_QUALITY = 80
AVOCADO_WEBP_QUALITY = 60


def resize_for_web(image):
    width, height = image.size
    long_edge = max(width, height)
    if long_edge <= MAX_LONG_EDGE_PIXELS:
        return image

    scale = MAX_LONG_EDGE_PIXELS / long_edge
    new_width = round(width * scale)
    new_height = round(height * scale)
    return image.resize(
        (new_width, new_height),
        Image.Resampling.LANCZOS,
    )


def prepare_photo(source_path, output_dir):
    with Image.open(source_path) as source_image:
        image = ImageOps.exif_transpose(source_image)
        image = image.convert("RGB")
        image = resize_for_web(image)

        output_path = output_dir / (source_path.stem + ".webp")
        quality = WEBP_QUALITY
        if source_path.stem == "williams-avocados":
            quality = AVOCADO_WEBP_QUALITY
        image.save(
            output_path,
            format="WEBP",
            quality=quality,
            method=6,
        )

    byte_count = output_path.stat().st_size
    if byte_count > MAX_SEED_PHOTO_BYTES:
        raise ValueError(
            output_path.name
            + " is larger than the 300 KB seed-photo limit. "
            + "Lower its quality or choose a different source photo."
        )

    width, height = image.size
    print(
        output_path.name
        + ": "
        + str(width)
        + "x"
        + str(height)
        + ", "
        + str(byte_count)
        + " bytes"
    )


def main():
    if len(sys.argv) != 3:
        print("Usage: prepare_seed_photos.py SOURCE_FOLDER OUTPUT_FOLDER")
        sys.exit(2)

    source_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    if not source_dir.is_dir():
        print("Source folder not found: " + str(source_dir))
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    source_paths = []
    for path in source_dir.iterdir():
        if path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            source_paths.append(path)
    source_paths.sort()

    if not source_paths:
        print("No source images were found in " + str(source_dir))
        sys.exit(1)

    try:
        for source_path in source_paths:
            prepare_photo(source_path, output_dir)
    except Exception as error:
        print("Photo preparation failed: " + str(error))
        sys.exit(1)


if __name__ == "__main__":
    main()
