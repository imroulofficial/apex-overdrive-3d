import * as THREE from 'three';

// Low-lying "volumetric" mist for every material, at no extra draw calls: the exponential
// fog chunks are extended with an analytic height fog. Mist is densest at sea level and thins
// out with height (scale HEIGHT_FOG.falloff metres), so it pools over the ocean, in the gorge
// and in the valleys while the hill tops stay clear; the amount of mist along each view ray is
// the exact integral of that density, plus a static world-space noise so it lies in banks.
//
// Three.js gives no per-scene hook for extra fog uniforms, so the mist strength rides on the
// FogExp2 density (race weather presets: data/weather.js). The garage's dark studio also uses
// FogExp2, but far denser; height fog only switches on below HEIGHT_FOG.maxDensity, which
// keeps it out of there. Linear THREE.Fog is untouched.

export const HEIGHT_FOG = {
  base: 2, // metres: full density at and below this height
  falloff: 13, // metres per e-fold of density above it
  strength: 3.2, // mist density at the base, relative to the distance fog density
  maxDensity: 0.01,
};

let installed = false;

export function installHeightFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	#ifdef FOG_EXP2
		varying vec3 vFogWorld;
	#endif
#endif
`;
  // World position from the view-space position: world = R^T * view + cameraPosition, where
  // the columns of viewMatrix's rotation are the rows of R^T. Works for instanced, skinned
  // and custom shaders alike (they all define mvPosition before this chunk).
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	#ifdef FOG_EXP2
		vFogWorld = vec3( dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) ) + cameraPosition;
	#endif
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
		varying vec3 vFogWorld;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  const H = HEIGHT_FOG;
  const f = (v) => v.toFixed(5);
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		if ( fogDensity < ${f(H.maxDensity)} ) {
			// Mean mist density along the ray from the eye to this fragment.
			float hk = ${f(1 / H.falloff)};
			float y0 = cameraPosition.y - ${f(H.base)};
			float dy = vFogWorld.y - cameraPosition.y;
			float a = exp( - max( y0, 0.0 ) * hk );
			float x = clamp( dy * hk, -12.0, 12.0 );
			float mean = abs( x ) > 1e-3 ? a * ( 1.0 - exp( - x ) ) / x : a;
			// Banks of mist: cheap static noise in the horizontal plane.
			vec2 q = vFogWorld.xz * 0.011;
			float banks = 0.65 + 0.35 * sin( q.x + 1.7 * sin( q.y * 1.3 ) ) * sin( q.y * 0.8 + 2.1 * sin( q.x * 0.7 ) );
			float mist = 1.0 - exp( - fogDensity * ${f(H.strength)} * banks * mean * vFogDepth );
			fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - mist );
		}
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

// The same mist on the CPU, for tests and for tuning presets: fog factor (0..1) for a point
// at `dist` metres and height `y`, seen from height `camY`, with fog density `density`.
export function heightFogFactor(density, dist, y, camY, banks = 1) {
  const H = HEIGHT_FOG;
  let fog = 1 - Math.exp(-((density * dist) ** 2));
  if (density < H.maxDensity) {
    const hk = 1 / H.falloff;
    const a = Math.exp(-Math.max(camY - H.base, 0) * hk);
    const x = Math.min(12, Math.max(-12, (y - camY) * hk));
    const mean = Math.abs(x) > 1e-3 ? (a * (1 - Math.exp(-x))) / x : a;
    const mist = 1 - Math.exp(-density * H.strength * banks * mean * dist);
    fog = 1 - (1 - fog) * (1 - mist);
  }
  return fog;
}
