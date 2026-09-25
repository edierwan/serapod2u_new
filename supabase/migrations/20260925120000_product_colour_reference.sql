-- Standard colour reference for Product Master structured Colour attributes.
-- This migration is intentionally separate from the application rollout and should be applied explicitly.
CREATE TABLE IF NOT EXISTS public.product_colour_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colour_name text NOT NULL,
  hex_code text NOT NULL,
  red smallint NOT NULL,
  green smallint NOT NULL,
  blue smallint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_colour_reference_name_nonblank CHECK (btrim(colour_name) <> ''),
  CONSTRAINT product_colour_reference_hex_format CHECK (hex_code ~ '^#[0-9A-F]{6}$'),
  CONSTRAINT product_colour_reference_red_range CHECK (red BETWEEN 0 AND 255),
  CONSTRAINT product_colour_reference_green_range CHECK (green BETWEEN 0 AND 255),
  CONSTRAINT product_colour_reference_blue_range CHECK (blue BETWEEN 0 AND 255),
  CONSTRAINT product_colour_reference_hex_unique UNIQUE (hex_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_colour_reference_name_unique
  ON public.product_colour_reference (lower(btrim(colour_name)));
CREATE INDEX IF NOT EXISTS product_colour_reference_active_sort
  ON public.product_colour_reference (is_active, sort_order, colour_name);

DROP TRIGGER IF EXISTS set_product_colour_reference_updated_at ON public.product_colour_reference;
CREATE TRIGGER set_product_colour_reference_updated_at
  BEFORE UPDATE ON public.product_colour_reference
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.product_colour_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read active product colours" ON public.product_colour_reference;
CREATE POLICY "Authenticated users can read active product colours"
  ON public.product_colour_reference
  FOR SELECT
  TO authenticated
  USING (is_active OR public.is_hq_admin());

DROP POLICY IF EXISTS "HQ admins can manage product colours" ON public.product_colour_reference;
CREATE POLICY "HQ admins can manage product colours"
  ON public.product_colour_reference
  FOR ALL
  TO authenticated
  USING (public.is_hq_admin())
  WITH CHECK (public.is_hq_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_colour_reference TO authenticated;
GRANT ALL ON public.product_colour_reference TO service_role;

INSERT INTO public.product_colour_reference
  (colour_name, hex_code, red, green, blue, sort_order)
VALUES
  ('Alice Blue', '#F0F8FF', 240, 248, 255, 1),
  ('Antique White', '#FAEBD7', 250, 235, 215, 2),
  ('Aquamarine', '#7FFFD4', 127, 255, 212, 3),
  ('Azure', '#F0FFFF', 240, 255, 255, 4),
  ('Beige', '#F5F5DC', 245, 245, 220, 5),
  ('Bisque', '#FFE4C4', 255, 228, 196, 6),
  ('Black', '#000000', 0, 0, 0, 7),
  ('Blanched Almond', '#FFEBCD', 255, 235, 205, 8),
  ('Blue', '#0000FF', 0, 0, 255, 9),
  ('Blue Violet', '#8A2BE2', 138, 43, 226, 10),
  ('Brown', '#A52A2A', 165, 42, 42, 11),
  ('Burly Wood', '#DEB887', 222, 184, 135, 12),
  ('Cadet Blue', '#5F9EA0', 95, 158, 160, 13),
  ('Chartreuse', '#7FFF00', 127, 255, 0, 14),
  ('Chocolate', '#D2691E', 210, 105, 30, 15),
  ('Coral', '#FF7F50', 255, 127, 80, 16),
  ('Cornflower Blue', '#6495ED', 100, 149, 237, 17),
  ('Cornsilk', '#FFF8DC', 255, 248, 220, 18),
  ('Crimson', '#DC143C', 220, 20, 60, 19),
  ('Cyan', '#00FFFF', 0, 255, 255, 20),
  ('Dark Blue', '#00008B', 0, 0, 139, 21),
  ('Dark Cyan', '#008B8B', 0, 139, 139, 22),
  ('Dark Goldenrod', '#B8860B', 184, 134, 11, 23),
  ('Dark Green', '#006400', 0, 100, 0, 24),
  ('Dark Grey', '#A9A9A9', 169, 169, 169, 25),
  ('Dark Khaki', '#BDB76B', 189, 183, 107, 26),
  ('Dark Magenta', '#8B008B', 139, 0, 139, 27),
  ('Dark Olive Green', '#556B2F', 85, 107, 47, 28),
  ('Dark Orange', '#FF8C00', 255, 140, 0, 29),
  ('Dark Orchid', '#9932CC', 153, 50, 204, 30),
  ('Dark Red', '#8B0000', 139, 0, 0, 31),
  ('Dark Salmon', '#E9967A', 233, 150, 122, 32),
  ('Dark Sea Green', '#8FBC8F', 143, 188, 143, 33),
  ('Dark Slate Blue', '#483D8B', 72, 61, 139, 34),
  ('Dark Slate Grey', '#2F4F4F', 47, 79, 79, 35),
  ('Dark Turquoise', '#00CED1', 0, 206, 209, 36),
  ('Dark Violet', '#9400D3', 148, 0, 211, 37),
  ('Deep Pink', '#FF1493', 255, 20, 147, 38),
  ('Deep Sky Blue', '#00BFFF', 0, 191, 255, 39),
  ('Dim Grey', '#696969', 105, 105, 105, 40),
  ('Dodger Blue', '#1E90FF', 30, 144, 255, 41),
  ('Firebrick', '#B22222', 178, 34, 34, 42),
  ('Floral White', '#FFFAF0', 255, 250, 240, 43),
  ('Forest Green', '#228B22', 34, 139, 34, 44),
  ('Gainsboro', '#DCDCDC', 220, 220, 220, 45),
  ('Ghost White', '#F8F8FF', 248, 248, 255, 46),
  ('Gold', '#FFD700', 255, 215, 0, 47),
  ('Goldenrod', '#DAA520', 218, 165, 32, 48),
  ('Green', '#008000', 0, 128, 0, 49),
  ('Green Yellow', '#ADFF2F', 173, 255, 47, 50),
  ('Grey', '#808080', 128, 128, 128, 51),
  ('Honeydew', '#F0FFF0', 240, 255, 240, 52),
  ('Hot Pink', '#FF69B4', 255, 105, 180, 53),
  ('Indian Red', '#CD5C5C', 205, 92, 92, 54),
  ('Indigo', '#4B0082', 75, 0, 130, 55),
  ('Ivory', '#FFFFF0', 255, 255, 240, 56),
  ('Khaki', '#F0E68C', 240, 230, 140, 57),
  ('Lavender', '#E6E6FA', 230, 230, 250, 58),
  ('Lavender Blush', '#FFF0F5', 255, 240, 245, 59),
  ('Lawn Green', '#7CFC00', 124, 252, 0, 60),
  ('Lemon Chiffon', '#FFFACD', 255, 250, 205, 61),
  ('Light Blue', '#ADD8E6', 173, 216, 230, 62),
  ('Light Coral', '#F08080', 240, 128, 128, 63),
  ('Light Cyan', '#E0FFFF', 224, 255, 255, 64),
  ('Light Goldenrod Yellow', '#FAFAD2', 250, 250, 210, 65),
  ('Light Green', '#90EE90', 144, 238, 144, 66),
  ('Light Grey', '#D3D3D3', 211, 211, 211, 67),
  ('Light Pink', '#FFB6C1', 255, 182, 193, 68),
  ('Light Salmon', '#FFA07A', 255, 160, 122, 69),
  ('Light Sea Green', '#20B2AA', 32, 178, 170, 70),
  ('Light Sky Blue', '#87CEFA', 135, 206, 250, 71),
  ('Light Slate Grey', '#778899', 119, 136, 153, 72),
  ('Light Steel Blue', '#B0C4DE', 176, 196, 222, 73),
  ('Light Yellow', '#FFFFE0', 255, 255, 224, 74),
  ('Lime', '#00FF00', 0, 255, 0, 75),
  ('Lime Green', '#32CD32', 50, 205, 50, 76),
  ('Linen', '#FAF0E6', 250, 240, 230, 77),
  ('Magenta', '#FF00FF', 255, 0, 255, 78),
  ('Maroon', '#800000', 128, 0, 0, 79),
  ('Medium Aquamarine', '#66CDAA', 102, 205, 170, 80),
  ('Medium Blue', '#0000CD', 0, 0, 205, 81),
  ('Medium Orchid', '#BA55D3', 186, 85, 211, 82),
  ('Medium Purple', '#9370DB', 147, 112, 219, 83),
  ('Medium Sea Green', '#3CB371', 60, 179, 113, 84),
  ('Medium Slate Blue', '#7B68EE', 123, 104, 238, 85),
  ('Medium Spring Green', '#00FA9A', 0, 250, 154, 86),
  ('Medium Turquoise', '#48D1CC', 72, 209, 204, 87),
  ('Medium Violet Red', '#C71585', 199, 21, 133, 88),
  ('Midnight Blue', '#191970', 25, 25, 112, 89),
  ('Mint Cream', '#F5FFFA', 245, 255, 250, 90),
  ('Misty Rose', '#FFE4E1', 255, 228, 225, 91),
  ('Moccasin', '#FFE4B5', 255, 228, 181, 92),
  ('Navajo White', '#FFDEAD', 255, 222, 173, 93),
  ('Navy', '#000080', 0, 0, 128, 94),
  ('Old Lace', '#FDF5E6', 253, 245, 230, 95),
  ('Olive', '#808000', 128, 128, 0, 96),
  ('Olive Drab', '#6B8E23', 107, 142, 35, 97),
  ('Orange', '#FFA500', 255, 165, 0, 98),
  ('Orange Red', '#FF4500', 255, 69, 0, 99),
  ('Orchid', '#DA70D6', 218, 112, 214, 100),
  ('Pale Goldenrod', '#EEE8AA', 238, 232, 170, 101),
  ('Pale Green', '#98FB98', 152, 251, 152, 102),
  ('Pale Turquoise', '#AFEEEE', 175, 238, 238, 103),
  ('Pale Violet Red', '#DB7093', 219, 112, 147, 104),
  ('Papaya Whip', '#FFEFD5', 255, 239, 213, 105),
  ('Peach Puff', '#FFDAB9', 255, 218, 185, 106),
  ('Peru', '#CD853F', 205, 133, 63, 107),
  ('Pink', '#FFC0CB', 255, 192, 203, 108),
  ('Plum', '#DDA0DD', 221, 160, 221, 109),
  ('Powder Blue', '#B0E0E6', 176, 224, 230, 110),
  ('Purple', '#800080', 128, 0, 128, 111),
  ('Rebecca Purple', '#663399', 102, 51, 153, 112),
  ('Red', '#FF0000', 255, 0, 0, 113),
  ('Rosy Brown', '#BC8F8F', 188, 143, 143, 114),
  ('Royal Blue', '#4169E1', 65, 105, 225, 115),
  ('Saddle Brown', '#8B4513', 139, 69, 19, 116),
  ('Salmon', '#FA8072', 250, 128, 114, 117),
  ('Sandy Brown', '#F4A460', 244, 164, 96, 118),
  ('Sea Green', '#2E8B57', 46, 139, 87, 119),
  ('Seashell', '#FFF5EE', 255, 245, 238, 120),
  ('Sienna', '#A0522D', 160, 82, 45, 121),
  ('Silver', '#C0C0C0', 192, 192, 192, 122),
  ('Sky Blue', '#87CEEB', 135, 206, 235, 123),
  ('Slate Blue', '#6A5ACD', 106, 90, 205, 124),
  ('Slate Grey', '#708090', 112, 128, 144, 125),
  ('Snow', '#FFFAFA', 255, 250, 250, 126),
  ('Spring Green', '#00FF7F', 0, 255, 127, 127),
  ('Steel Blue', '#4682B4', 70, 130, 180, 128),
  ('Tan', '#D2B48C', 210, 180, 140, 129),
  ('Teal', '#008080', 0, 128, 128, 130),
  ('Thistle', '#D8BFD8', 216, 191, 216, 131),
  ('Tomato', '#FF6347', 255, 99, 71, 132),
  ('Turquoise', '#40E0D0', 64, 224, 208, 133),
  ('Violet', '#EE82EE', 238, 130, 238, 134),
  ('Wheat', '#F5DEB3', 245, 222, 179, 135),
  ('White', '#FFFFFF', 255, 255, 255, 136),
  ('White Smoke', '#F5F5F5', 245, 245, 245, 137),
  ('Yellow', '#FFFF00', 255, 255, 0, 138),
  ('Yellow Green', '#9ACD32', 154, 205, 50, 139)
ON CONFLICT (hex_code) DO UPDATE SET
  colour_name = EXCLUDED.colour_name,
  red = EXCLUDED.red,
  green = EXCLUDED.green,
  blue = EXCLUDED.blue,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMENT ON TABLE public.product_colour_reference IS
  'Standard colour palette used to suggest readable Product Master colour names.';
