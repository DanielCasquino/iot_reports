set encoding utf8
set style data histograms
set style histogram clustered gap 1
set style fill solid 0.85 border -1
set boxwidth 0.85
set logscale y 10
set yrange [1:500]
set ylabel "Median raw count (log scale)"
set xlabel "Observed pilot condition"
set key outside top center horizontal
set grid ytics back
set border 3
set tics nomirror
set terminal svg size 900,500 font "Arial,13"
set output "figures/rgb_calibration.svg"
plot "data/rgb_calibration_medians.dat" using 2:xtic(1) title "R" lc rgb "#ad2929", "" using 3 title "G" lc rgb "#287a3f", "" using 4 title "B" lc rgb "#3262ad", "" using 5 title "Clear" lc rgb "#666666"
set terminal pngcairo size 1500,850 font "Sans,18"
set output "figures/rgb_calibration.png"
replot
set terminal pdfcairo size 6.8in,3.8in font "Sans,10"
set output "figures/rgb_calibration.pdf"
replot
