import type { PartOf } from "../../data/schema";
import type { Actor, Category } from "../types";

export type AssemblyView = "side" | "footprint";

export interface AssemblyParts {
  case?: PartOf<"case">;
  motherboard?: PartOf<"motherboard">;
  gpu?: PartOf<"gpu">;
  cooler?: PartOf<"cooler">;
  psu?: PartOf<"psu">;
}

const BOARD_MM = {
  ITX: { height: 170, depth: 170 },
  mATX: { height: 244, depth: 244 },
  ATX: { height: 305, depth: 244 },
  "E-ATX": { height: 305, depth: 330 },
} as const;

const PSU_MM = {
  SFX: { width: 125, height: 64, depth: 100 },
  "SFX-L": { width: 125, height: 64, depth: 130 },
  ATX: { width: 150, height: 86, depth: 140 },
} as const;

/**
 * The catalog knows volume and clearances, but not manufacturer exterior dimensions.
 * This solves a representative enclosure whose volume is exact and whose aspect ratio
 * follows the largest supported board. It is intentionally labelled representative.
 */
function representativeEnvelope(casePart?: PartOf<"case">, boardFactor = "ATX" as keyof typeof BOARD_MM) {
  const liters = casePart?.volumeLiters ?? (boardFactor === "ITX" ? 18 : boardFactor === "mATX" ? 32 : 46);
  const board = BOARD_MM[boardFactor];
  const compact = casePart ? casePart.volumeLiters < 24 : boardFactor === "ITX";
  const ratio = compact ? { width: 0.53, height: 0.84, depth: 1 } : boardFactor === "mATX" ? { width: 0.5, height: 0.94, depth: 1 } : { width: 0.51, height: 1.04, depth: 1 };
  const unit = Math.cbrt((liters * 1_000_000) / (ratio.width * ratio.height * ratio.depth));
  // Keep the visible tray large enough for the case's modeled board and GPU
  // capacities, then solve width so the stated volume remains exact.
  const height = Math.max(unit * ratio.height, board.height + 42);
  const depth = Math.max(unit * ratio.depth, board.depth + 34, (casePart?.maxGpuLengthMm ?? 0) + 26);
  return {
    width: Math.round((liters * 1_000_000) / (height * depth)),
    height: Math.round(height),
    depth: Math.round(depth),
    liters,
  };
}

function Dimension({ x1, y1, x2, y2, label, danger = false }: { x1: number; y1: number; x2: number; y2: number; label: string; danger?: boolean }) {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const color = danger ? "var(--color-fault)" : "var(--color-ash)";
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const labelWidth = Math.max(34, label.length * 5.35);
  return (
    <g color={color} fontFamily="var(--font-mono)" fontSize="9">
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.8" markerStart="url(#measure-arrow)" markerEnd="url(#measure-arrow)" />
      {horizontal && <rect x={centerX - labelWidth / 2} y={centerY - 17} width={labelWidth} height="13" rx="2" fill="var(--color-iron)" stroke="none" opacity=".92" />}
      <text x={centerX + (horizontal ? 0 : 8)} y={centerY + (horizontal ? -7 : 3)} fill="currentColor" textAnchor={horizontal ? "middle" : "start"}>
        {label}
      </text>
    </g>
  );
}

export function CaseSilhouette({
  filled,
  parts = {},
  flash,
  view = "side",
  className = "",
}: {
  filled: Partial<Record<Category, boolean>>;
  parts?: AssemblyParts;
  /** Which slot to flash and by whom (re-render with a new key to replay). */
  flash?: { category: Category; actor: Actor } | null;
  view?: AssemblyView;
  className?: string;
}) {
  const boardFactor = parts.motherboard?.formFactor ?? parts.case?.formFactorSupport.at(-1) ?? "ATX";
  const board = BOARD_MM[boardFactor];
  const envelope = representativeEnvelope(parts.case, boardFactor);
  const compactShell = envelope.liters < 24;
  const gpuLength = parts.gpu?.lengthMm ?? 285;
  const gpuThickness = (parts.gpu?.slots ?? 2.5) * 20.32;
  const gpuMax = parts.case?.maxGpuLengthMm;
  const coolerHeight = parts.cooler?.type === "air" ? parts.cooler.heightMm : undefined;
  const coolerMax = parts.case?.maxCoolerHeightMm;
  const psu = PSU_MM[parts.psu?.formFactor ?? "ATX"];

  const boardFits = !parts.case || parts.case.formFactorSupport.includes(boardFactor);
  const gpuFits = !gpuMax || !parts.gpu || gpuLength <= gpuMax;
  const coolerFits = !coolerMax || !coolerHeight || coolerHeight <= coolerMax;
  const psuFits = !parts.case || !parts.psu || parts.case.psuFormFactor.includes(parts.psu.formFactor);

  const ink = "var(--color-bone)";
  const dim = "var(--color-dust)";
  const seam = "var(--color-seam-strong)";
  const flashColor = flash?.actor === "agent" ? "var(--color-ember)" : "var(--color-glacier)";
  const componentStyle = (cat: Category, valid = true) => {
    const on = !!filled[cat];
    const flashing = flash?.category === cat;
    return {
      fill: on ? "var(--color-plate)" : "rgba(255,255,255,.22)",
      stroke: !valid ? "var(--color-fault)" : flashing ? flashColor : on ? ink : dim,
      strokeWidth: !valid || flashing ? 2 : on ? 1.25 : 0.9,
      strokeDasharray: on ? undefined : "5 4",
      style: flashing ? { filter: `drop-shadow(0 0 5px ${flashColor})` } : undefined,
    } as const;
  };

  const sideScale = Math.min(350 / envelope.depth, 244 / envelope.height);
  const caseW = envelope.depth * sideScale;
  const caseH = envelope.height * sideScale;
  const caseX = 38 + (370 - caseW) / 2;
  const caseY = 55 + (250 - caseH) / 2;
  const floorY = caseY + caseH;
  const rearX = caseX;
  const mm = (n: number) => n * sideScale;
  const psuX = compactShell ? caseX + caseW - mm(psu.depth + 14) : caseX + mm(14);
  const psuY = floorY - mm(psu.height + 12);
  const towerPsuZone = psu.height + 28;
  const boardX = rearX + mm(16);
  const boardY = floorY - mm(compactShell ? 26 : towerPsuZone) - mm(board.height);
  const gpuX = rearX + mm(15);
  const gpuHeightPx = Math.max(8, mm(gpuThickness));
  const gpuY = compactShell ? floorY - mm(92) - mm(gpuThickness / 2) : psuY - mm(14) - gpuHeightPx;
  const gpuMeasureY = Math.max(caseY + 18, boardY - 10);

  const footprintScale = Math.min(350 / envelope.depth, 190 / envelope.width);
  const fpW = envelope.depth * footprintScale;
  const fpH = envelope.width * footprintScale;
  const fpX = 38 + (370 - fpW) / 2;
  const fpY = 76 + (190 - fpH) / 2;

  return (
    <svg viewBox="0 0 520 390" className={className} role="img" aria-labelledby="assembly-title assembly-desc">
      <title id="assembly-title">Proportional PC assembly {view === "side" ? "side" : "footprint"} view</title>
      <desc id="assembly-desc">
        Component dimensions are drawn to a common scale. The case exterior is a representative envelope derived from catalog volume because exact exterior dimensions are not stored.
      </desc>
      <defs>
        <pattern id="bench-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="rgba(36,76,60,.09)" strokeWidth="0.65" />
        </pattern>
        <pattern id="pcb-grid" width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M9 0H0V9" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="0.6" />
        </pattern>
        <marker id="measure-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L6 3 0 6Z" fill="currentColor" />
        </marker>
      </defs>
      <rect width="520" height="390" rx="10" fill="url(#bench-grid)" />

      <g fontFamily="var(--font-sans)">
        <text x="26" y="25" fill={ink} fontSize="13" fontWeight="650">Build measurement board</text>
        <text x="494" y="25" fill={dim} fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">
          {view === "side" ? "TRAY / SIDE" : "FOOTPRINT / TOP"} · 1 SHARED SCALE
        </text>
      </g>

      {view === "side" ? (
        <>
          <g {...componentStyle("case")}>
            <title>{parts.case ? `${parts.case.name}: ${envelope.liters} L representative exterior envelope` : "Representative enclosure — select a case to use its volume and clearances"}</title>
            <rect x={caseX} y={caseY} width={caseW} height={caseH} rx="5" fill="rgba(255,255,255,.34)" />
            <line x1={caseX + caseW - mm(16)} y1={caseY + mm(16)} x2={caseX + caseW - mm(16)} y2={floorY - mm(16)} opacity=".45" />
            <g fill={dim} stroke="none" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing=".7">
              <text x={caseX + mm(10)} y={caseY + 13}>REAR</text>
              <text x={caseX + caseW - mm(10)} y={caseY + 13} textAnchor="end">FRONT</text>
            </g>
            {compactShell ? (
              <g opacity=".5" aria-label="Compact case ventilation">
                {Array.from({ length: 8 }, (_, i) => (
                  <line
                    key={i}
                    x1={caseX + caseW - mm(27)}
                    x2={caseX + caseW - mm(10)}
                    y1={caseY + caseH * (0.24 + i * 0.065)}
                    y2={caseY + caseH * (0.24 + i * 0.065)}
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                ))}
              </g>
            ) : (
              <g opacity=".42" aria-label="Representative front airflow zone">
                <rect
                  x={caseX + caseW - mm(76)}
                  y={caseY + mm(34)}
                  width={mm(58)}
                  height={Math.max(20, caseH - mm(68))}
                  rx="3"
                  fill="none"
                  strokeDasharray="3 4"
                />
                {[0.34, 0.52, 0.7].map((position) => (
                  <path
                    key={position}
                    d={`M${caseX + caseW - mm(26)} ${caseY + caseH * position}H${caseX + caseW - mm(63)}`}
                    fill="none"
                    strokeWidth=".8"
                    markerEnd="url(#measure-arrow)"
                  />
                ))}
              </g>
            )}
          </g>

          <g {...componentStyle("motherboard", boardFits)} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{`${boardFactor} board standard: ${board.depth} × ${board.height} mm${boardFits ? "" : " — unsupported by selected case"}`}</title>
            <rect x={boardX} y={boardY} width={mm(board.depth)} height={mm(board.height)} rx="2" fill={filled.motherboard ? "#2f7655" : "rgba(47,118,85,.06)"} />
            {filled.motherboard && <rect x={boardX} y={boardY} width={mm(board.depth)} height={mm(board.height)} rx="2" fill="url(#pcb-grid)" stroke="none" />}
            <path d={`M${boardX + mm(12)} ${boardY + mm(board.height * 0.7)}H${boardX + mm(board.depth * 0.82)}M${boardX + mm(board.depth * 0.76)} ${boardY + mm(14)}V${boardY + mm(board.height * 0.52)}`} fill="none" opacity=".65" />
            <text x={boardX + mm(8)} y={boardY + mm(16)} fill={filled.motherboard ? "rgba(255,255,255,.9)" : dim} stroke="none" fontFamily="var(--font-mono)" fontSize="8">
              {boardFactor} · {board.depth} × {board.height} mm
            </text>
          </g>

          <g {...componentStyle("cpu")} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{filled.cpu ? "Selected CPU in motherboard socket" : "CPU socket placeholder"}</title>
            <rect x={boardX + mm(board.depth * 0.34)} y={boardY + mm(board.height * 0.22)} width={mm(38)} height={mm(38)} rx="2" />
            <circle cx={boardX + mm(board.depth * 0.34 + 19)} cy={boardY + mm(board.height * 0.22 + 19)} r={mm(12)} fill="none" />
          </g>

          <g {...componentStyle("ram")} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{filled.ram ? "Selected memory kit" : "Memory slots placeholder"}</title>
            {[0, 1].map((i) => (
              <rect key={i} x={boardX + mm(board.depth * 0.76 + i * 10)} y={boardY + mm(board.height * 0.18)} width={mm(7)} height={mm(68)} rx="1" />
            ))}
          </g>

          <g {...componentStyle("storage")} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{filled.storage ? "Selected motherboard storage" : "M.2 storage placeholder"}</title>
            <rect x={boardX + mm(board.depth * 0.1)} y={boardY + mm(board.height * 0.76)} width={mm(58)} height={Math.max(5, mm(9))} rx="1" />
          </g>

          {/* Compact sandwich cases collapse two chambers into this side projection.
              Paint the far-side PSU first so the near-side GPU occludes it. */}
          <g {...componentStyle("psu", psuFits)} opacity={compactShell ? 0.62 : undefined} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{parts.psu ? `${parts.psu.name}: ${parts.psu.formFactor} form factor${compactShell ? " in the opposite chamber" : ""}${psuFits ? "" : " — unsupported by selected case"}` : "Power supply placeholder"}</title>
            <rect x={psuX} y={psuY} width={mm(psu.depth)} height={mm(psu.height)} rx="2" />
            <circle cx={psuX + mm(psu.depth * 0.52)} cy={psuY + mm(psu.height * 0.5)} r={Math.max(5, mm(psu.height * 0.32))} fill="none" />
            {compactShell && filled.psu && (
              <text x={psuX + mm(psu.depth / 2)} y={psuY + mm(14)} fill={ink} stroke="none" fontFamily="var(--font-mono)" fontSize="7" textAnchor="middle">
                PSU · FAR SIDE
              </text>
            )}
          </g>

          <g {...componentStyle("gpu", gpuFits)} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{parts.gpu ? `${parts.gpu.name}: ${gpuLength} mm long, ${parts.gpu.slots} slots${gpuFits ? "" : " — exceeds case clearance"}` : "Graphics card placeholder"}</title>
            <rect x={gpuX} y={gpuY} width={mm(gpuLength)} height={gpuHeightPx} rx="2" fill={filled.gpu ? "#38413d" : "transparent"} />
            {filled.gpu && (
              <>
                <line x1={gpuX + mm(10)} y1={gpuY + gpuHeightPx - 5} x2={gpuX + mm(gpuLength * 0.72)} y2={gpuY + gpuHeightPx - 5} stroke="var(--color-caution)" strokeWidth="1.2" />
                <text x={gpuX + mm(10)} y={gpuY + 12} fill="rgba(255,255,255,.86)" stroke="none" fontFamily="var(--font-mono)" fontSize="7.5">
                  GPU EDGE · {parts.gpu?.slots ?? 2.5} SLOT
                </text>
              </>
            )}
          </g>

          {(filled.cooler || filled.case) && (
            <g transform="translate(422 63)">
              <text x="36" y="0" fill={dim} fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle">SIDE-PANEL DEPTH</text>
              <line x1="5" y1="112" x2="72" y2="112" stroke={seam} />
              <rect x="7" y="18" width="7" height="94" fill="#2f7655" opacity=".7" />
              <rect x="14" y={112 - Math.min(94, ((coolerHeight ?? 125) / Math.max(coolerMax ?? 170, coolerHeight ?? 0)) * 94)} width="42" height={Math.min(94, ((coolerHeight ?? 125) / Math.max(coolerMax ?? 170, coolerHeight ?? 0)) * 94)} rx="2" {...componentStyle("cooler", coolerFits)} />
              <line x1="64" y1="18" x2="64" y2="112" stroke={coolerFits ? seam : "var(--color-fault)"} strokeDasharray="3 2" />
              <text x="36" y="126" fill={coolerFits ? ink : "var(--color-fault)"} fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle">
                {coolerHeight ? `${coolerHeight} / ${coolerMax ?? "—"} mm` : `max ${coolerMax ?? "—"} mm`}
              </text>
            </g>
          )}

          <Dimension x1={caseX} y1={floorY + 21} x2={caseX + caseW} y2={floorY + 21} label={`representative depth ${envelope.depth} mm`} />
          <Dimension x1={caseX - 15} y1={caseY} x2={caseX - 15} y2={floorY} label={`${envelope.height} mm`} />
          {filled.gpu && (
            <>
              <line x1={gpuX} y1={gpuMeasureY} x2={gpuX} y2={gpuY} stroke={gpuFits ? seam : "var(--color-fault)"} strokeWidth=".7" strokeDasharray="2 3" opacity=".55" />
              <line x1={gpuX + mm(gpuLength)} y1={gpuMeasureY} x2={gpuX + mm(gpuLength)} y2={gpuY} stroke={gpuFits ? seam : "var(--color-fault)"} strokeWidth=".7" strokeDasharray="2 3" opacity=".55" />
              <Dimension x1={gpuX} y1={gpuMeasureY} x2={gpuX + mm(gpuLength)} y2={gpuMeasureY} label={`GPU ${gpuLength}${gpuMax ? ` / ${gpuMax}` : ""} mm`} danger={!gpuFits} />
            </>
          )}
        </>
      ) : (
        <>
          <g {...componentStyle("case")}>
            <title>{`${envelope.liters} L representative case footprint`}</title>
            <rect x={fpX} y={fpY} width={fpW} height={fpH} rx="7" fill="rgba(255,255,255,.38)" />
            <rect x={fpX + 10} y={fpY + 10} width={fpW - 20} height={fpH - 20} rx="4" fill="none" strokeDasharray="4 3" opacity=".45" />
          </g>
          <g {...componentStyle("gpu", gpuFits)} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{`GPU projected footprint: ${gpuLength} mm × ${Math.round(gpuThickness)} mm`}</title>
            <rect x={fpX + 14} y={fpY + fpH * 0.28} width={gpuLength * footprintScale} height={Math.max(9, gpuThickness * footprintScale)} rx="2" fill={filled.gpu ? "#38413d" : "transparent"} />
          </g>
          <g {...componentStyle("psu", psuFits)} tabIndex={0} className="outline-none transition-opacity hover:opacity-80 focus:opacity-80">
            <title>{`${parts.psu?.formFactor ?? "ATX"} PSU representative projected footprint: ${psu.depth} × ${psu.width} mm`}</title>
            <rect x={fpX + fpW - psu.depth * footprintScale - 14} y={fpY + fpH - psu.width * footprintScale - 12} width={psu.depth * footprintScale} height={psu.width * footprintScale} rx="2" />
          </g>
          <Dimension x1={fpX} y1={fpY + fpH + 24} x2={fpX + fpW} y2={fpY + fpH + 24} label={`representative depth ${envelope.depth} mm`} />
          <Dimension x1={fpX - 16} y1={fpY} x2={fpX - 16} y2={fpY + fpH} label={`width ${envelope.width} mm`} />

          <g transform="translate(420 73)">
            <text x="37" y="0" fill={dim} fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle">BOARD STANDARD</text>
            <rect x="4" y="12" width={70 * (board.depth / Math.max(board.depth, board.height))} height={70 * (board.height / Math.max(board.depth, board.height))} fill={filled.motherboard ? "#2f7655" : "rgba(47,118,85,.06)"} stroke={boardFits ? ink : "var(--color-fault)"} strokeDasharray={filled.motherboard ? undefined : "4 3"} />
            <text x="37" y="94" fill={boardFits ? ink : "var(--color-fault)"} fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle">{boardFactor}</text>
            <text x="37" y="105" fill={dim} fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle">{board.depth} × {board.height} mm</text>
          </g>
        </>
      )}

      <g transform="translate(26 348)" fontFamily="var(--font-mono)" fontSize="8.5">
        <circle cx="4" cy="-3" r="3" fill={parts.case ? "var(--color-caution)" : dim} />
        <text x="13" y="0" fill={ink}>
          {parts.case ? `${envelope.liters} L volume-true representative shell` : "No case selected · reference shell only"}
        </text>
        <text x="13" y="14" fill={dim}>solid = selected · dashed = reference · red = conflict</text>
      </g>
    </svg>
  );
}
