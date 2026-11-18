async function main() {
  const response = await fetch("https://example.com/");
  console.log(response.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
