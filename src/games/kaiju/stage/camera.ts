import * as THREE from 'three'
import { SHORE_Z } from '../arena'
import { WATER_Y, wobble, type Pose } from './director'

/*
  The stage's camera operator. The director says where the camera should be for the shot on air (director.ts
  shotPose); this follows it: a new shot is a hard cut (the camera jumps there), within a shot it glides after its
  subjects with a little lag so the framing breathes instead of jittering, and the shake from the blows and the
  falling buildings is added on top (a smooth wobble, never a jitter). It never dips under the ground or the water.
*/

export class CamRig {
  readonly cam: THREE.PerspectiveCamera
  private readonly eye = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private fov = 36
  private cut = -999
  private readonly e = new THREE.Vector3()
  private readonly t = new THREE.Vector3()

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(36, aspect, 0.5, 4000)
  }

  /**
   * Points the camera for a shot: `cut` changes when the shot does (then it jumps); `snap` jumps anyway (the clock
   * jumped); `shake` 0 to about 1.5; `time` the show's clock in ms (the shake's wobble follows it, so it freezes in a
   * hit-stop like everything else).
   */
  apply(p: Pose, cut: number, dt: number, shake: number, time: number, snap: boolean, lag = 4.5) {
    this.e.set(p.eye.x, p.eye.y, p.eye.z)
    this.t.set(p.target.x, p.target.y, p.target.z)
    if (cut !== this.cut || snap) {
      this.cut = cut
      this.eye.copy(this.e)
      this.look.copy(this.t)
      this.fov = p.fov
    } else {
      const k = 1 - Math.exp(-dt * lag)
      this.eye.lerp(this.e, k)
      this.look.lerp(this.t, 1 - Math.exp(-dt * lag * 1.4))
      this.fov += (p.fov - this.fov) * k
    }
    const c = this.cam
    c.position.copy(this.eye)
    const floor = this.eye.z < SHORE_Z ? WATER_Y + 1.2 : 0.9
    if (c.position.y < floor) c.position.y = floor
    const s = shake * shake
    if (s > 0.0005) {
      const amp = 0.55 * s
      c.position.x += wobble(time, 1.3) * amp
      c.position.y += wobble(time, 4.1) * amp * 0.8
      c.position.z += wobble(time, 7.7) * amp * 0.5
    }
    c.lookAt(this.look.x + (s > 0.0005 ? wobble(time, 2.9) * 0.3 * s : 0), this.look.y + (s > 0.0005 ? wobble(time, 5.3) * 0.3 * s : 0), this.look.z)
    if (s > 0.0005) c.rotateZ(wobble(time, 9.1) * 0.012 * s)
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov
      c.updateProjectionMatrix()
    }
  }

  setAspect(a: number) {
    this.cam.aspect = a
    this.cam.updateProjectionMatrix()
  }
}
