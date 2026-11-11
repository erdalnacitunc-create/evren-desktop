const f = (a: string, b: string, c = true): { x: string } => ({
  x: a
});
// comment
{
  console.log(f('a', 'b'))
}
