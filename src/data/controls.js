// Touch control schemes, picked in Settings → Controls (see race/input.js).
//   touch  Touch Drive: split left / right steering pad (default)
//   tilt   Tilt-to-Steer: gyroscope steering with GAS and BRAKE pedals
//   wheel  Virtual Steering Wheel: analog rotary wheel on the left, pedals on the right
export const CONTROL_SCHEMES = ['touch', 'tilt', 'wheel'];
export const DEFAULT_CONTROLS = 'touch';

// Race camera views, cycled by the HUD camera button (or C) and kept in settings.cameraView.
//   chase  Dynamic Chase Cam: trails the direction of travel, widens with speed (default)
//   close  Close Follow Cam: low and tight behind the bumper
//   hood   Hood / Bumper View: on the nose, locked to the car
export const CAMERA_VIEWS = ['chase', 'close', 'hood'];
export const DEFAULT_CAMERA = 'chase';
export const CAMERA_LABELS = { chase: 'Chase cam', close: 'Close follow', hood: 'Hood view' };
