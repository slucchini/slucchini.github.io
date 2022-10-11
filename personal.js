$(document).ready(function(){
	$('#nav-icon1').click(function(){
		$(this).toggleClass('open');
		$('#nav').toggleClass('open');
	});

	$('.buttons>a').click(function(){
		$('.buttons>a').each(function(){
			$(this).removeClass('active')
		});
		$(this).toggleClass('active');
		showResearch(this)
	})
	showResearch($('.buttons>a.active'))
});

function showResearch(activeButton) {
	var activeClass = ''
	$('.buttons>a.active').attr('class').split(' ').forEach(function(item,indx,arr) {
		if (item != 'active') {
			activeClass = item
		}
	})
	$('div#body .content').each(function(){
		$(this).addClass('hidden')
	})
	$('div#body .content.'+activeClass).each(function(){
		$(this).removeClass('hidden')
	})
	$('.underliner').css('left',$(activeButton).position().left+14)
	$('.underliner').css('width',$(activeButton).width()+14)
}