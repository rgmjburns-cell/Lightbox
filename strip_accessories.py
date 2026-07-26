import re

with open('src/components/games/ColourRex.tsx', 'r') as f:
    content = f.read()

# Remove type definitions
content = re.sub(
    r'type AccessoryType = "glasses" \| "party-hat" \| "bow-tie";\n\ninterface PlacedAccessory \{\n  id: string;\n  type: AccessoryType;\n  x: number;\n  y: number;\n\}\n\n',
    '', content
)

# Remove state variables
content = re.sub(
    r'  // ── Accessories state ──\n  const \[showAccessories.*?const nextAccId = useRef\(0\);\n',
    '', content, flags=re.DOTALL
)

# Remove early return in handleCanvasTap
content = content.replace(
    '      if (selectedAccessory) return; // placing accessory, not colouring\n',
    ''
)

# Fix dependency array
content = content.replace(
    '[showComplete, selectedAccessory, selectedColor, saveUndoSnapshot]',
    '[showComplete, selectedColor, saveUndoSnapshot]'
)

# Remove handleSvgClick
content = re.sub(
    r'  // ── Handle SVG tap for accessory placement\n.*?    \[selectedAccessory\],\n',
    '', content, flags=re.DOTALL
)

# Remove renderAccessory
content = re.sub(
    r'  // ── Render accessory SVG ──\n.*?  \}\n\n',
    '', content, flags=re.DOTALL
)

# Remove SVG overlay section in JSX (between SVG overlay comment and accessories menu)
content = re.sub(
    r'        \{/\* SVG overlay for accessories \*/\}.*?\n      \{/\* ── Accessories menu ──',
    '\n      {/* ── Accessories menu ──',
    content, flags=re.DOTALL
)

# Remove accessories menu
content = re.sub(
    r'      \{/\* ── Accessories menu ── \*/\}\n      \{showAccessories && \(\n.*?      \}\)\n\n',
    '', content, flags=re.DOTALL
)

# Remove accessories button
content = re.sub(
    r'        <button\n          onClick.*?setShowAccessories.*?\n.*?\n        </button>\n',
    '', content, flags=re.DOTALL
)

# Remove unused refs
content = content.replace(
    "  const svgRef = useRef<SVGSVGElement>(null);\n",
    ''
)
content = content.replace(
    "  const [draggingAcc, setDraggingAcc] = useState<string | null>(null);\n",
    ''
)

# Remove accessory mention in completion modal
content = re.sub(
    r'            \{placedAccessories\.length > 0 && \(\n.*?accessory\{placedAccessories\.length > 1 \? "es" : ""\}!\n            \)\}\n',
    '', content, flags=re.DOTALL
)

# Remove touchAction condition referencing selectedAccessory
content = re.sub(
    r'          style=\{\{ touchAction: selectedAccessory \? "auto" : "none" \}\}',
    '          style={{ touchAction: "none" }}',
    content
)

with open('src/components/games/ColourRex.tsx', 'w') as f:
    f.write(content)

print("Done")
