import re

with open('src/components/games/ColourRex.tsx', 'r') as f:
    lines = f.readlines()

# Build new file excluding lines with accessory-related content
out = []
skip_until_match = None
for i, line in enumerate(lines):
    ln = i + 1

    # Skip type defs (lines 33-42)
    if ln >= 33 and ln <= 42:
        continue

    # Skip the handleCanvasTap early return
    if 'if (selectedAccessory) return;' in line:
        continue

    # Fix dependency array
    if 'selectedAccessory, selectedColor, saveUndoSnapshot' in line:
        line = line.replace('selectedAccessory, selectedColor, saveUndoSnapshot', 'selectedColor, saveUndoSnapshot')

    # Skip accessory handler section entirely
    if '// ── Accessory handlers ──' in line:
        skip_until_match = '// ── Render accessory SVG ──'
        continue
    if skip_until_match and skip_until_match in line:
        skip_until_match = None
        continue
    if skip_until_match:
        continue

    # Skip renderAccessory function (lines 528-560ish)
    if '// ── Render accessory SVG ──' in line:
        skip_until_match = '// ── Component JSX'
        continue
    if skip_until_match and skip_until_match in line:
        skip_until_match = None
        # Don't skip this line
    elif skip_until_match:
        continue

    # Skip accessories JSX
    if 'selectedAccessory' in line or 'placedAccessories' in line or 'showAccessories' in line or 'draggingAcc' in line or 'svgRef' in line:
        continue

    # Skip unused vars
    if "const [draggingAcc, setDraggingAcc]" in line:
        continue
    if "const svgRef = useRef" in line:
        continue

    # Fix touchAction
    if 'touchAction: selectedAccessory' in line:
        line = line.replace('touchAction: selectedAccessory ? "auto" : "none"', 'touchAction: "none"')

    # Fix pointerEvents 
    if 'pointerEvents: selectedAccessory || draggingAcc' in line:
        line = line.replace('pointerEvents: selectedAccessory || draggingAcc ? "all" : "none"', 'pointerEvents: "none"')

    out.append(line)

with open('src/components/games/ColourRex.tsx', 'w') as f:
    f.writelines(out)

print(f"Done: {len(lines)} -> {len(out)} lines")
