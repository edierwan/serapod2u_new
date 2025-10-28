#!/bin/bash

# Simple PNG icon generator for Serapod2u PWA
# This creates placeholder icons - replace with actual logo later

cd "$(dirname "$0")"/public/icons

# Create a simple SVG logo
cat > logo.svg << 'EOF'
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#2563eb"/>
  <text x="256" y="280" font-family="Arial, sans-serif" font-size="180" font-weight="bold" fill="white" text-anchor="middle">S2U</text>
  <text x="256" y="360" font-family="Arial, sans-serif" font-size="48" fill="#93c5fd" text-anchor="middle">Supply Chain</text>
</svg>
EOF

echo "✓ Created logo.svg placeholder"
echo ""
echo "📋 Next steps:"
echo "   1. Replace logo.svg with your actual logo"
echo "   2. Use an online tool to generate PNG icons:"
echo "      - https://realfavicongenerator.net/"
echo "      - https://www.favicon-generator.org/"
echo "   3. Or use ImageMagick:"
echo "      brew install imagemagick"
echo "      for size in 72 96 128 144 152 192 384 512; do"
echo "        convert logo.svg -resize \${size}x\${size} icon-\${size}x\${size}.png"
echo "      done"
echo ""
echo "   Place generated PNGs in: /public/icons/"
