/**
 * The "style stack": independent art-direction axes that combine into a single scene, mirroring the
 * layered system in the Cozyverse reference decks (art style, edge treatment, construction, material,
 * realism, lighting, color, atmosphere, camera — each a separate dial, not a bundled category).
 * Every axis defaults to "" (unset) so existing World-Bible-only prompts are unaffected until a user
 * opts into a layer.
 */
export type StylePreset = { value: string; label: string; fragment: string };

const NONE: StylePreset = { value: "", label: "None", fragment: "" };

export const ART_STYLE_PRESETS: StylePreset[] = [
  NONE,
  { value: "cozy-3d-diorama", label: "Cozy 3D Diorama", fragment: "isometric miniature diorama, soft forms, warm lighting, comforting handcrafted details" },
  { value: "cinematic-isometric", label: "Cinematic Isometric", fragment: "cinematic isometric rendering, dramatic light direction, atmospheric depth, film-like color grading" },
  { value: "miniature-toy", label: "Miniature / Toy-Like", fragment: "collectible-model aesthetic, clean silhouettes, simplified geometry, tactile toy-like surfaces" },
  { value: "handcrafted-clay", label: "Handcrafted Clay", fragment: "handcrafted clay miniature, rounded sculpted buildings and characters, softly imperfect edges" },
  { value: "wooden-miniature", label: "Wooden Miniature", fragment: "carved wood miniature, warm wood-grain textures, handcrafted model-set feel" },
  { value: "paper-craft", label: "Paper Craft / Layered Paper", fragment: "layered paper-craft diorama, folded-paper foliage, cut-paper architecture, visible dimensional layering" },
  { value: "soft-pastel-3d", label: "Soft Pastel 3D", fragment: "soft pastel 3D rendering, gentle low-contrast palette, creamy dreamy light" },
  { value: "anime-soft-3d", label: "Anime-Inspired Soft 3D", fragment: "anime-inspired stylized 3D, expressive soft lighting, romantic skies" },
  { value: "storybook-3d", label: "Storybook 3D", fragment: "vintage storybook 3D illustration style, whimsical proportions, charming slightly magical color design" },
  { value: "low-poly-cozy", label: "Low-Poly Cozy", fragment: "low-poly faceted geometry, simplified forms, warm and readable despite the facets" },
  // Broader, non-diorama art styles — for users who want Cozyverse's tools without the miniature/
  // diorama framing baked into every image. Each fragment deliberately omits diorama/miniature
  // language so it reads as a clean, independent visual direction.
  { value: "photorealistic", label: "Photorealistic", fragment: "photorealistic rendering, natural full-scale proportions, lifelike materials and lighting, sharp detail" },
  { value: "watercolor", label: "Watercolor Illustration", fragment: "hand-painted watercolor illustration, soft bleeding pigment edges, visible paper texture, gentle color washes" },
  { value: "flat-vector", label: "Flat 2D Vector", fragment: "flat 2D vector illustration, clean bold shapes, minimal shading, limited confident color palette" },
  { value: "pixel-art", label: "Pixel Art", fragment: "retro pixel art, visible pixel grid, limited color palette, crisp hard edges" },
  { value: "claymation", label: "Claymation / Stop-Motion", fragment: "stop-motion claymation aesthetic, fingerprint-textured clay surfaces, slightly imperfect handmade forms, felt and wire props" },
  { value: "ghibli-inspired", label: "Hand-Painted Anime Backdrop", fragment: "hand-painted anime background art, lush painterly detail, soft atmospheric lighting, nostalgic warmth" },
  { value: "noir-comic", label: "Noir Comic Ink", fragment: "high-contrast noir comic-book inking, dramatic black shadows, cross-hatching, stark graphic silhouettes" },
  { value: "oil-painting", label: "Classical Oil Painting", fragment: "classical oil painting, rich textured brushwork, deep glazed color, painterly light and shadow" },
  { value: "cyberpunk-neon", label: "Cyberpunk Neon", fragment: "cyberpunk neon aesthetic, glowing signage, rain-slicked reflective surfaces, saturated magenta and cyan lighting" },
  { value: "dark-fantasy", label: "Dark Fantasy", fragment: "dark fantasy illustration, moody desaturated palette, dramatic scale, ominous atmosphere" },
  { value: "vintage-travel-poster", label: "Vintage Travel Poster", fragment: "vintage travel-poster illustration, bold flat color blocks, retro typography-era composition, sun-faded palette" },
  { value: "cel-shaded-anime", label: "Cel-Shaded Anime", fragment: "cel-shaded anime style, clean line art, flat shadow blocks, vibrant saturated color" },
  { value: "charcoal-sketch", label: "Charcoal Sketch", fragment: "loose charcoal sketch, expressive smudged shading, monochrome with selective warm highlights" },
  { value: "isometric-pixel-city", label: "Isometric Pixel City", fragment: "isometric pixel-art cityscape, crisp tile-based geometry, saturated retro-game palette" },
];

export const EDGE_STYLE_PRESETS: StylePreset[] = [
  NONE,
  { value: "classic-floating", label: "Classic Floating Diorama", fragment: "classic floating diorama base, visible cutaway edge, rock/soil underside, collectible miniature feel" },
  { value: "hybrid-soft-edge", label: "Hybrid Soft-Edge", fragment: "hybrid soft-edge diorama — the miniature stays readable but rocks, plants, water or mist soften the perimeter" },
  { value: "natural-grounded", label: "Natural Grounded", fragment: "naturally grounded diorama with no visible base — terrain flows outward through haze, foreground occlusion, and horizon" },
];

export const CONSTRUCTION_PRESETS: StylePreset[] = [
  NONE,
  { value: "classic-tabletop", label: "Classic Tabletop Diorama", fragment: "classic tabletop diorama presentation, partially visible base, clean rounded edges, camera close to the tabletop" },
  { value: "cinematic-invisible-base", label: "Cinematic Invisible-Base", fragment: "cinematic invisible-base diorama, base hidden through framing and shallow depth of field, immersive yet still miniature" },
  { value: "collector-display", label: "Collector Display Diorama", fragment: "polished collector-display diorama on a deliberate platform, strong silhouette, refined premium display-object feel" },
  { value: "cutaway-room", label: "Cutaway Room Diorama", fragment: "cutaway-room diorama, one or more walls removed so the interior reads like a dollhouse or architectural model" },
  { value: "dollhouse-cinematic", label: "Dollhouse Cinematic", fragment: "dollhouse-cinematic construction, softer and more cinematic than a toy, viewed from a three-quarter angle" },
  { value: "shadowbox", label: "Shadowbox Diorama", fragment: "shadowbox diorama, shallow boxed world with visible side or back walls, like a framed display case" },
  { value: "stage-set", label: "Stage Set Diorama", fragment: "stage-set diorama, resembles a miniature film or theater set — practical lights, platforms, scenery flats subtly visible" },
  { value: "museum-miniature", label: "Museum Miniature Diorama", fragment: "museum miniature diorama, clean carefully arranged educational-display precision with strong visual hierarchy" },
  { value: "storybook-diorama", label: "Storybook Diorama", fragment: "storybook diorama construction, soft whimsical simplified shapes with believable depth and lighting" },
  { value: "luxury-miniature", label: "Luxury Miniature Diorama", fragment: "luxury miniature diorama, sophisticated restrained materials, elegant lighting, refined clean construction" },
];

export const MATERIAL_PRESETS: StylePreset[] = [
  NONE,
  { value: "matte-resin", label: "Matte Resin Miniature", fragment: "matte resin miniature material, smooth slightly rounded edges, controlled reflections, premium collectible-figure finish" },
  { value: "painted-wood", label: "Painted Wood Miniature", fragment: "painted-wood miniature material, warm tactile handcrafted wood surfaces" },
  { value: "clay-diorama", label: "Clay Diorama", fragment: "clay diorama material, soft sculpted surfaces, slightly imperfect handmade forms, subdued textures" },
  { value: "felt-fabric", label: "Felt & Fabric Diorama", fragment: "felt-and-fabric diorama material, soft textile landscape with wool, thread, and stitched details" },
  { value: "paper-craft-material", label: "Paper Craft Diorama", fragment: "paper-craft diorama material, layered cardstock, folded paper, cutout architecture" },
  { value: "cardboard-model", label: "Cardboard Model Diorama", fragment: "cardboard-model diorama material, slightly rougher handmade aesthetic using kraft paper and painted chipboard" },
  { value: "acrylic", label: "Acrylic Diorama", fragment: "acrylic diorama material, smooth transparent/translucent panels, colored resin surfaces, controlled glow" },
  { value: "ceramic", label: "Ceramic Miniature", fragment: "ceramic miniature material, rounded glazed forms, matte walls, simplified tactile geometry" },
  { value: "mixed-material", label: "Mixed-Material Diorama", fragment: "mixed-material diorama — wood, resin, paper, fabric and clay appearing together but visually unified" },
];

export const REALISM_PRESETS: StylePreset[] = [
  NONE,
  { value: "soft-toy-like", label: "Soft Toy-Like", fragment: "strongly simplified forms, very rounded edges, reduced texture detail, oversized props — clearly miniature" },
  { value: "stylized-miniature", label: "Stylized Miniature", fragment: "balanced handcrafted realism, believable but simplified materials — the strongest all-purpose default" },
  { value: "cinematic-miniature", label: "Cinematic Miniature", fragment: "more realistic lighting and materials while keeping miniature scale through shallow focus and proportion" },
  { value: "premium-collectible", label: "Premium Collectible", fragment: "highly polished character and prop modeling, similar to an expensive display collectible" },
  { value: "near-real-diorama", label: "Near-Real Diorama", fragment: "near-real diorama — environment approaches realistic cinematography while subtle scale cues preserve the miniature read" },
];

export const LIGHTING_PRESETS: StylePreset[] = [
  NONE,
  { value: "warm-practical-glow", label: "Warm Practical Glow", fragment: "tiny lamps and fixtures creating localized warm pools of light" },
  { value: "cool-window-warm-interior", label: "Cool Window / Warm Interior", fragment: "cool blue exterior light contrasting warm amber interior light" },
  { value: "rainy-neon", label: "Rainy Neon", fragment: "small colored neon signage interacting with rain-darkened surfaces" },
  { value: "golden-hour-miniature", label: "Golden Hour Miniature", fragment: "warm low-angle sunlight casting long soft shadows across the miniature" },
  { value: "moonlit-blue", label: "Moonlit Blue", fragment: "cool nighttime moonlight with a few restrained warm practical lights" },
  { value: "candlelit", label: "Candlelit", fragment: "extremely warm localized candlelight highlights with deep soft shadows" },
  { value: "stage-side-light", label: "Stage Side Light", fragment: "directional side light creating dramatic miniature silhouettes" },
  { value: "soft-overcast", label: "Soft Overcast", fragment: "large diffused overcast illumination with low contrast" },
  { value: "sunrise-glow", label: "Sunrise Glow", fragment: "cream, peach, pale gold and soft blue sunrise tones" },
  { value: "window-shaft", label: "Window Shaft", fragment: "a single defined beam of light entering the set as the dominant lighting idea" },
  { value: "high-key-bright", label: "High-Key Bright", fragment: "bright even high-key lighting, minimal shadow, airy and clean" },
  { value: "backlit-silhouette", label: "Backlit Silhouette", fragment: "strong backlight rimming the subject, foreground details falling into soft silhouette" },
  { value: "storm-flicker", label: "Storm Flicker", fragment: "cold ambient storm light punctuated by brief lightning-flash highlights" },
  { value: "aurora-glow", label: "Aurora Glow", fragment: "shifting aurora-colored ambient light washing cool green and violet across the scene" },
];

export const COLOR_PRESETS: StylePreset[] = [
  NONE,
  { value: "amber-walnut", label: "Amber Walnut", fragment: "amber walnut palette — amber, walnut brown, cream, deep brown" },
  { value: "burgundy-soul", label: "Burgundy Soul", fragment: "burgundy soul palette — burgundy, plum, navy, amber" },
  { value: "rainy-blue", label: "Rainy Blue", fragment: "rainy blue palette — deep blue, blue-gray, muted teal, small warm highlights" },
  { value: "forest-sage", label: "Forest Sage", fragment: "forest sage palette — sage, olive, cream, natural wood" },
  { value: "autumn-vinyl", label: "Autumn Vinyl", fragment: "autumn vinyl palette — rust, mustard, brown, cream, dark green" },
  { value: "neon-midnight", label: "Neon Midnight", fragment: "neon midnight palette — charcoal, navy, cyan, magenta" },
  { value: "snow-amber", label: "Snow & Amber", fragment: "snow and amber palette — soft blue-white, warm amber, dark wood" },
  { value: "vintage-cafe", label: "Vintage Café", fragment: "vintage café palette — cream, faded green, brass, brown, dusty red" },
  { value: "coastal-soft", label: "Coastal Soft", fragment: "coastal soft palette — seafoam, pale blue, sand, cream" },
  { value: "classical-ivory", label: "Classical Ivory", fragment: "classical ivory palette — ivory, muted gold, mahogany, dusty blue" },
];

export const ATMOSPHERE_PRESETS: StylePreset[] = [
  NONE,
  { value: "rainy-window", label: "Rainy Window", fragment: "rain droplets and condensation with soft exterior blur" },
  { value: "soft-haze", label: "Soft Haze", fragment: "minimal atmospheric haze giving gentle depth around light sources" },
  { value: "coffee-steam", label: "Coffee Steam", fragment: "tiny trails of steam adding intimate motion" },
  { value: "dusty-sunbeam", label: "Dusty Sunbeam", fragment: "subtle floating dust particles visible inside one beam of light" },
  { value: "snowfall", label: "Snowfall", fragment: "slow, sparse miniature snowfall" },
  { value: "forest-mist", label: "Forest Mist", fragment: "low soft mist drifting between miniature trees" },
  { value: "city-after-rain", label: "City After Rain", fragment: "dark reflective ground with restrained wet reflections" },
  { value: "quiet-midnight", label: "Quiet Midnight", fragment: "very little atmosphere — darkness and a few small lights carry the mood" },
  { value: "dream-haze", label: "Dream Haze", fragment: "soft glow and atmospheric separation without losing object readability" },
];

export const CAMERA_PRESETS: StylePreset[] = [
  NONE,
  { value: "macro-intimacy", label: "Macro Intimacy", fragment: "very close miniature camera, shallow focus, one strong subject" },
  { value: "tabletop-reveal", label: "Tabletop Reveal", fragment: "camera clearly reveals the scene as a constructed tabletop miniature" },
  { value: "three-quarter-diorama", label: "Three-Quarter Diorama", fragment: "classic three-quarter diagonal diorama view showing both front and side depth" },
  { value: "eye-level-miniature", label: "Eye-Level Miniature", fragment: "camera sits almost at the character's scale, making the world feel immersive" },
  { value: "high-angle-storybook", label: "High-Angle Storybook", fragment: "camera looks down gently over the scene, storybook framing" },
  { value: "overhead-model", label: "Overhead Model", fragment: "top-down overhead view clearly showing the entire miniature layout" },
  { value: "wide-environmental", label: "Wide Environmental", fragment: "wide shot showing most of the set while maintaining a miniature depth effect" },
  { value: "foreground-peek", label: "Foreground Peek", fragment: "camera looks through a blurred foreground prop, plant, or railing, hiding the base edges" },
  { value: "window-view", label: "Window View", fragment: "camera looks through or toward a window, creating strong layered depth" },
  { value: "cross-section-reveal", label: "Cross-Section Reveal", fragment: "camera emphasizes the physical cutaway construction of the environment" },
];

export type StyleStackControls = {
  artStyle: string;
  edgeStyle: string;
  construction: string;
  material: string;
  realism: string;
  lightingPreset: string;
  colorPreset: string;
  atmospherePreset: string;
  cameraPreset: string;
};

export const defaultStyleStack = (): StyleStackControls => ({
  artStyle: "",
  edgeStyle: "",
  construction: "",
  material: "",
  realism: "",
  lightingPreset: "",
  colorPreset: "",
  atmospherePreset: "",
  cameraPreset: "",
});

const STACK_AXES: Array<{ key: keyof StyleStackControls; presets: StylePreset[] }> = [
  { key: "artStyle", presets: ART_STYLE_PRESETS },
  { key: "edgeStyle", presets: EDGE_STYLE_PRESETS },
  { key: "construction", presets: CONSTRUCTION_PRESETS },
  { key: "material", presets: MATERIAL_PRESETS },
  { key: "realism", presets: REALISM_PRESETS },
  { key: "lightingPreset", presets: LIGHTING_PRESETS },
  { key: "colorPreset", presets: COLOR_PRESETS },
  { key: "atmospherePreset", presets: ATMOSPHERE_PRESETS },
  { key: "cameraPreset", presets: CAMERA_PRESETS },
];

/** Resolves every set axis in the stack to its prompt fragment, in a fixed, sensible order. */
export function composeStyleStackFragments(stack: StyleStackControls): string[] {
  const fragments: string[] = [];
  for (const { key, presets } of STACK_AXES) {
    const value = stack[key];
    if (!value) continue;
    const preset = presets.find((p) => p.value === value);
    if (preset && preset.fragment) fragments.push(preset.fragment);
  }
  return fragments;
}

/** How many axes have a non-default selection — used to badge the collapsed Style Stack panel. */
export function activeStackCount(stack: StyleStackControls): number {
  return STACK_AXES.reduce((count, { key }) => count + (stack[key] ? 1 : 0), 0);
}
