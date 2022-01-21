export default `
#define PI 3.14159265359
attribute float aScale;
void main() {
  vec3 transformed = position.xyz;
  transformed *= aScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.);
}
`