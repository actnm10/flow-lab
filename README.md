# Flow Lab

A local 3D fluid-field simulator with native WebGL 2 rendering and a numerical D3Q19 lattice-Boltzmann solver. No Three.js, external web libraries, package installation, network assets, or cloud services are used.

## Open

On this Windows computer, double-click **Start Flow Lab.cmd**. It starts a small local service and opens **http://127.0.0.1:8766** in your browser. Node.js and Blender are already available on this computer. Keep the files together.

On another computer, install Node.js and Blender, then run `node server.cjs` from this folder. For a nonstandard Blender location, set `BLENDER_PATH` to the Blender executable before starting the server. The launcher automatically detects installed Windows Blender versions. The service listens only on your computer's loopback address. If you start it in a terminal, Ctrl+C stops it.

Use the launcher or server rather than opening index.html directly: the browser worker and Blender import require the local service.

## Explore

- Drag the scene to orbit. Scroll to zoom. Shift-drag or right-drag to pan. The Orbit, Side, Top and Front buttons give repeatable views.
- Choose **Rotate object** to rotate the obstacle freely by dragging the scene. **Orbit camera** switches back to moving the camera. The X, Y and Z rotation sliders and degree entries provide precise control; **Reset angles** restores the imported orientation.
- The **Align X**, **Align Y** and **Align Z** presets point the selected **Model forward axis** along the corresponding tunnel axis. X is the flow direction, Y is up, and Z is across the tunnel. For example, with Local X selected, Align Y points the object's local positive X axis upward. Local axes refer to the centered, imported geometry after Blender's saved scene transforms and up-axis conversion; they are not necessarily the original Blender object-local axes.
- Orientation changes preview immediately. The old field is hidden during rotation, and releasing the drag or slider recalculates the solid boundary and starts a new solution. A paused experiment stays paused. This models a stationary object at its new angle, not a continuously spinning wall. The object's physical scale stays fixed through rotation, and size/quality changes preserve its orientation. A new import resets the angles.
- **Freeze** or Space stops the simulation and tracers while leaving the camera free. **Step** advances the paused numerical solution by one solver step. **Restart** resets the current flow.
- Change inlet speed, object diameter or kinematic viscosity to start a new calculation. Solver quality changes spatial resolution and restarts the calculation.
- Inlet speed ranges from **0.2 to 30 m/s**, with a default of 1 m/s. The readout shows the effective viscosity used by the solver when its existing stability limit requires an increase. At 30 m/s on the balanced grid, that effective viscosity is approximately 0.933 m²/s; the inlet still uses the selected 30 m/s.
- Change lighting, tracer density, colors, vectors and the center slice without resetting the physical solution.
- **Playback rate** sets the requested rate of physical evolution; the achieved rate is limited by the available CPU and selected grid. Rendering and solving run separately.
- **Save image** exports the current scene as a PNG.

## Import an object

Drop a `.blend`, `.obj` or `.stl` file anywhere in the scene, or click the import area. The sphere is replaced by the evaluated geometry, and the fluid boundary is rebuilt from it. Reset restores the sphere.

For Blender files, installed Blender evaluates the active scene at its saved frame, including modifiers, curves and object instances. Viewport-hidden or render-hidden objects are skipped. The result preserves object transforms, is centered in the tunnel, and is scaled so its longest bounding-box dimension equals the diameter setting. Blender's Z-up coordinates are converted to the simulation's Y-up coordinates. Direct OBJ/STL coordinates are used as stored; these formats do not reliably declare an up axis or units.

Use closed, watertight solids. Disconnected Blender objects are voxelized separately and combined as solids; holes such as the center of a torus are retained. Thin surfaces and details smaller than a grid cell may not become solid cells. Open meshes produce a warning when inconsistent ray intersections are detected; that check is not a complete mesh validator.

Imports are limited to 150 MB and 250,000 evaluated triangles. Conversion times out after 90 seconds. Very complex subdivisions and scenes should be simplified first. Embedded Blender scripts are disabled; drivers depending on those scripts may not evaluate. Files are processed locally and temporary conversion files are removed afterwards.

## Physical model and its limits

The solver uses the isothermal D3Q19 BGK lattice-Boltzmann method. It streams and collides 19 populations per cell and applies halfway bounce-back to links intersecting voxelized solids. The uniform inlet and far-field lateral boundaries prescribe the incoming fluid; an outflow relaxation zone precedes the zero-gradient outlet.

The domain is 16 × 8 × 8 metres. Grid options are 72 × 36 × 36, 96 × 48 × 48 and 128 × 64 × 64. At the default 2.3 m sphere diameter, 1 m/s inlet and 0.04 m²/s viscosity, Re = 57.5. Fluid density is fixed at 1.225 kg/m³. These are deliberately viscous, low-Reynolds-number conditions that fit the available grid; this is not a full-scale high-Re air-turbulence model.

The default sphere starts from the analytical creeping-flow velocity field as an initial guess, then evolves numerically. Imported geometry starts from uniform external velocity. Allow several object transit times for the wake to develop. The development indicator is time × inlet speed / diameter; it is not a convergence certificate.

The lattice inlet speed is 0.075, corresponding to Mach 0.13 in the numerical lattice. Viscosity is bounded to keep relaxation time at or above 0.542. If your requested conditions exceed that stability range, the app reports the increased effective viscosity; the displayed Reynolds number always uses this effective value.

Streamlines integrate the current solved velocity with midpoint integration. They show an instantaneous velocity field, not the past path of an individual fluid parcel. Tracers are advected through successive fields. Vorticity is the magnitude of the central-difference curl of velocity; every visible flow layer uses the same scalar.

Static pressure colors are derived from the solved lattice density, relative to the far-field reference. Static + gravity additionally includes −ρgy. This is not stagnation pressure. Uniform gravity is hydrostatically balanced in this constant-density model; it changes pressure without making the bulk fluid fall. There is no free surface, multiphase flow, thermal buoyancy or turbulence closure.

This is an exploratory simulation, **not a validated engineering analysis**. A finite tunnel, voxelized curved boundaries, weak compressibility, limited resolution, and simple inlet/outlet treatment affect quantitative accuracy. A critic's visual score does not establish force accuracy, grid independence or experimental agreement. Compare resolutions and use a validated CFD package for design decisions.

## References

- [Zou and He: pressure and velocity flow boundary conditions for lattice-Boltzmann BGK models](https://arxiv.org/abs/comp-gas/9508001) — background on LBM boundaries; this app uses the simpler boundaries described above, not a full Zou–He implementation.
- [Blender dependency graph and evaluated geometry](https://docs.blender.org/api/5.0/bpy.types.Depsgraph.html).
- [Blender command-line arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html).

## Files

`index.html`, `style.css`, `app.js`: interface and renderer. `solver.js`: independent browser worker. `server.cjs`: local server and conversion endpoint using Node's standard library. `convert.py`: evaluated Blender geometry extraction. `start.ps1` and `Start Flow Lab.cmd`: Windows launcher.
